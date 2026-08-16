import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as admin from 'firebase-admin';

const prisma = new PrismaClient();

// URL do webhook do n8n que irá disparar o WhatsApp via WAHA
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/guardiao-alerta';

async function enviarComandoLockFCM(deviceId: string) {
  try {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device || !device.fcmToken) return;
    
    const mensagem = { data: { comando: "LOCK" }, token: device.fcmToken };
    await admin.messaging().send(mensagem);
    console.log(`✅ [CRON] Comando LOCK via FCM enviado para ${deviceId}`);
  } catch (error) {
    console.error(`❌ [CRON] Erro ao enviar FCM:`, error);
  }
}

export async function auditTimers() {
  try {
    const now = new Date();
    
    // Busca todos os timers ativos cujo tempo esgotou
    const expiredTimers = await prisma.timer.findMany({
      where: {
        isActive: true,
        targetTimestamp: { lte: now } // lte = Less Than or Equal
      },
      include: {
        contacts: true,
        device: {
          include: { user: true }
        }
      }
    });

    if (expiredTimers.length === 0) return;

    console.log(`⏰ [CRON] Encontrados ${expiredTimers.length} timer(s) expirado(s)! Iniciando protocolo de alerta...`);

    for (const timer of expiredTimers) {
      // 1. Marca o timer como inativo
      await prisma.timer.update({
        where: { id: timer.id },
        data: { isActive: false }
      });

      // 2. Coloca o dispositivo em PÂNICO
      await prisma.device.update({
        where: { id: timer.deviceId },
        data: { status: 'PANICO' }
      });

      // 3. Registra o evento de pânico
      await prisma.panicEvent.create({
        data: {
          deviceId: timer.deviceId,
          triggerType: 'TIMER_EXPIRADO'
        }
      });

      // 4. Bloqueia o celular
      await enviarComandoLockFCM(timer.deviceId);

      // 5. Dispara webhook para o n8n avisar os contatos
      if (timer.contacts.length > 0) {
        const linkResgate = `https://guardiao-public.onrender.com/resgate/${timer.deviceId}`;
        
        for (const contact of timer.contacts) {
          try {
            await axios.post(N8N_WEBHOOK_URL, {
              contactPhone: contact.phone,
              contactName: contact.name,
              userName: timer.device.user?.name || 'Seu contato',
              eventName: timer.eventName,
              rescueLink: linkResgate
            });
            console.log(`✅ [CRON] Webhook n8n disparado para o contato ${contact.name}`);
          } catch (err: any) {
            console.error(`❌ [CRON] Falha ao disparar webhook para n8n: ${err.message}`);
          }
        }
      } else {
        console.warn(`⚠️ [CRON] Timer ${timer.id} expirou, mas não havia contatos vinculados.`);
      }
    }
  } catch (error) {
    console.error(`❌ [CRON] Erro crítico ao auditar timers:`, error);
  }
}

export function startTimerAuditor() {
  console.log('⏰ Timer Auditor iniciado. Checando a cada 60 segundos...');
  setInterval(auditTimers, 60000); // Roda a cada 60 segundos
}
