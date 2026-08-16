import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import * as admin from 'firebase-admin';

const prisma = new PrismaClient();

// ==========================================
// FUNÇÕES AUXILIARES (espelhadas do app.ts para manter o job isolado)
// ==========================================

/**
 * Calcula a distância em metros entre dois pontos geográficos
 * usando a fórmula de Haversine.
 */
function calcularDistanciaHaversine(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Raio da Terra em metros
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) *
      Math.cos(lat2 * rad) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Dispara o comando de LOCK para o dispositivo via Firebase Cloud Messaging.
 * Falhas de rede são capturadas internamente para não interromper o Job.
 */
async function enviarComandoLockFCM(fcmToken: string, deviceId: string, triggerType: string): Promise<void> {
  console.log(`📡 [AUDITOR] [${deviceId}] Disparando LOCK via FCM. Motivo: ${triggerType}`);
  try {
    const mensagem = { data: { comando: 'LOCK' }, token: fcmToken };
    const response = await admin.messaging().send(mensagem);
    console.log(`✅ [AUDITOR] Comando FCM enviado. ID: ${response}`);
  } catch (error) {
    // Loga mas não relança: o device pode estar offline, isso não é falha do Job
    console.error(`❌ [AUDITOR] Falha ao enviar FCM para [${deviceId}]:`, error);
  }
}

/**
 * Simula o alerta para os contatos de emergência vinculados ao timer.
 * Agora integrado com n8n via Webhook.
 */
async function alertarContatosDeEmergencia(
  deviceId: string,
  contatos: Array<{ name: string; phone: string }>,
  eventName: string,
  userName: string = 'Seu contato'
): Promise<void> {
  const linkResgate = `https://guardiao-public.onrender.com/resgate/${deviceId}`;
  const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/guardiao-alerta';

  if (contatos.length === 0) {
    console.warn(`⚠️ [AUDITOR] Timer de [${deviceId}] expirou em perigo, mas sem contatos cadastrados para notificar.`);
    return;
  }

  for (const contato of contatos) {
    console.log(`\n======================================================`);
    console.log(`📱 ALERTA N8N → ${contato.name} (${contato.phone}):`);
    console.log(`"Alerta Guardião: A usuária não chegou ao destino no horário combinado.`);
    console.log(`Por favor, acesse o painel urgente para verificar:`);
    console.log(`👉 ${linkResgate} "`);
    console.log(`======================================================\n`);

    try {
      // Dispara o webhook para o n8n
      const axios = require('axios');
      await axios.post(N8N_WEBHOOK_URL, {
        contactPhone: contato.phone,
        contactName: contato.name,
        userName: userName,
        eventName: eventName,
        rescueLink: linkResgate
      });
      console.log(`✅ [AUDITOR] Webhook n8n disparado com sucesso para ${contato.name}`);
    } catch (error: any) {
      console.error(`❌ [AUDITOR] Falha ao disparar webhook para n8n:`, error.message);
    }
  }
}

// ==========================================
// LÓGICA PRINCIPAL DO JOB
// ==========================================

/**
 * Audita todos os timers ativos que já ultrapassaram o targetTimestamp.
 * Chamado a cada minuto pelo cron scheduler.
 */
async function auditarTimers(): Promise<void> {
  console.log(`\n🔍 [AUDITOR] Iniciando varredura de timers expirados... [${new Date().toISOString()}]`);

  // 1. Busca todos os timers ativos cujo prazo já passou
  const timersExpirados = await prisma.timer.findMany({
    where: {
      isActive: true,
      checkedIn: false,
      targetTimestamp: { lte: new Date() },
    },
    include: {
      device: {           // Precisamos do fcmToken, deviceId e user
        include: { user: true }
      },
      safeZone: true,     // Precisamos das coordenadas e raio da zona segura
      contacts: {         // Precisamos dos dados para alertar
        select: { id: true, name: true, phone: true },
      },
    },
  });

  if (timersExpirados.length === 0) {
    console.log(`✅ [AUDITOR] Nenhum timer expirado encontrado. Encerrando varredura.\n`);
    return;
  }

  console.log(`⚠️ [AUDITOR] ${timersExpirados.length} timer(s) expirado(s) encontrado(s). Processando...`);

  // 2. Itera sobre cada timer expirado de forma independente
  for (const timer of timersExpirados) {
    // Bloco try/catch por timer: um erro num timer não pode derrubar os outros
    try {
      console.log(`\n⏳ [AUDITOR] Processando Timer #${timer.id} ("${timer.eventName}") do device [${timer.deviceId}]`);

      // 3. Busca a última localização registrada para o device
      const lastLocation = await prisma.location.findFirst({
        where: { deviceId: timer.deviceId },
        orderBy: { timestamp: 'desc' },
      });

      // --- AVALIAÇÃO DE SEGURANÇA ---

      // Cenário A: Localização existe E timer tem SafeZone vinculada → Geofencing
      if (lastLocation && timer.safeZone) {
        const distancia = calcularDistanciaHaversine(
          timer.safeZone.latitude,
          timer.safeZone.longitude,
          lastLocation.latitude,
          lastLocation.longitude
        );

        console.log(
          `📏 [AUDITOR] Distância de "${timer.safeZone.name}": ${distancia.toFixed(2)}m ` +
          `(raio seguro: ${timer.safeZone.radiusMeters}m)`
        );

        // Condição de Segurança: dentro do raio → Auto-resolve silencioso
        if (distancia <= timer.safeZone.radiusMeters) {
          console.log(`✅ [AUDITOR] Timer #${timer.id}: Usuária DENTRO da zona segura. Auto-resolvendo silenciosamente.`);

          await prisma.timer.update({
            where: { id: timer.id },
            data: { isActive: false, checkedIn: true },
          });

          continue; // Próximo timer — nenhuma ação de perigo necessária
        }

        // Condição de Perigo: fora do raio → cai no bloco de perigo abaixo
        console.log(`🚨 [AUDITOR] Timer #${timer.id}: Usuária FORA da zona segura. Acionando protocolos de emergência!`);
      } else {
        // Cenário B: Sem localização ou sem SafeZone → PERIGO por omissão
        const motivo = !lastLocation
          ? 'sem sinal de GPS registrado'
          : 'sem zona segura vinculada ao timer';
        console.log(`🚨 [AUDITOR] Timer #${timer.id}: PERIGO (${motivo}). Acionando protocolos de emergência!`);
      }

      // --- PROTOCOLO DE EMERGÊNCIA ---
      // Chegou aqui = timer em estado de PERIGO

      // 4a. Atualiza o status do dispositivo para PÂNICO no banco
      await prisma.device.update({
        where: { id: timer.deviceId },
        data: { status: 'PANICO' },
      });

      // 4b. Registra o PanicEvent para auditoria
      await prisma.panicEvent.create({
        data: {
          deviceId: timer.deviceId,
          triggerType: 'TIMER_EXPIRED',
        },
      });

      // 4c. Encerra o timer (sem marcar checkedIn — ela não fez check-in)
      await prisma.timer.update({
        where: { id: timer.id },
        data: { isActive: false },
      });

      // 4d. Dispara FCM de LOCK (se o device tiver token cadastrado)
      if (timer.device.fcmToken) {
        await enviarComandoLockFCM(timer.device.fcmToken, timer.deviceId, 'TIMER_EXPIRED');
      } else {
        console.warn(`⚠️ [AUDITOR] Device [${timer.deviceId}] sem fcmToken. Comando LOCK não enviado.`);
      }

      // 4e. Alerta os contatos de emergência vinculados ao timer
      await alertarContatosDeEmergencia(
        timer.deviceId, 
        timer.contacts, 
        timer.eventName, 
        timer.device.user?.name || 'Seu contato'
      );

    } catch (error) {
      // Falha isolada: loga com contexto e continua para o próximo timer
      console.error(
        `💥 [AUDITOR] ERRO ao processar Timer #${timer.id} do device [${timer.deviceId}]. ` +
        `O job continua para os próximos timers.`,
        error
      );
    }
  }

  console.log(`\n🏁 [AUDITOR] Varredura concluída.\n`);
}

// ==========================================
// INICIALIZAÇÃO E EXPORTAÇÃO DO CRON JOB
// ==========================================

/**
 * Inicia o CronJob de auditoria de timers.
 * Agendado para rodar a cada 1 minuto.
 * Deve ser chamado UMA VEZ no bootstrap do servidor (server.ts).
 */
export function iniciarTimerAuditor(): void {
  console.log('⏰ [AUDITOR] CronJob de auditoria de timers iniciado. Rodando a cada 1 minuto.');

  cron.schedule('* * * * *', async () => {
    try {
      await auditarTimers();
    } catch (error) {
      // Captura falhas catastróficas (ex: banco completamente offline) sem derrubar o servidor
      console.error('💥 [AUDITOR] Falha catastrófica na varredura. O servidor continua de pé.', error);
    }
  });
}
