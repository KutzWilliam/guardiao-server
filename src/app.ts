import express, { Request, Response } from 'express';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client'; // NOVO: Importação do Prisma

const keyPath = path.resolve(__dirname, '../firebase-key.json');

if (fs.existsSync(keyPath)) {
  const serviceAccount = require(keyPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log("🔥 Firebase Admin inicializado com sucesso.");
} else {
  console.warn("⚠️ Arquivo firebase-key.json não encontrado!");
  console.warn("   └ Se isto for um teste no GitHub (Jest), ignore. O sistema não vai quebrar.");
  console.warn("   └ Se for no Render, certifique-se de ter adicionado o Secret File.");
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// NOVO: Inicialização do cliente de Banco de Dados
const prisma = new PrismaClient();

const MEU_TOKEN_FCM = "dWVHc4_GRf2JlqVNwP5fj7:APA91bHpUMdAaxNzqEZ0RnEL8XH0W75lew48rhZBVJQYrNppSZZXE4Y8__zoCxuii2ldCM2SiFypLdTcQXr7O5J50ETU7SmVSSkQWI93MK3Db0tGw8YaZEc";

// MOCK DB reduzido: Agora apenas gere os identificadores dos Timers da RAM do Node
const mockDB = {
  timers: new Map<string, NodeJS.Timeout>()
};

// ==========================================
// FUNÇÕES AUXILIARES
// ==========================================

function calcularDistanciaHaversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function enviarComandoLockFCM(deviceId: string, triggerType: string) {
  console.log(`📡 [${deviceId}] Disparando comando de LOCK via FCM. Motivo: ${triggerType}...`);
  try {
    const mensagem = { data: { comando: "LOCK" }, token: MEU_TOKEN_FCM };
    const response = await admin.messaging().send(mensagem);
    console.log(`✅ Comando enviado com sucesso! ID: ${response}`);
  } catch (error) {
    console.error(`❌ Erro ao enviar FCM:`, error);
  }
}

function alertarContatoDeEmergencia(deviceId: string) {
  const linkResgate = `https://SEU_URL_DO_RENDER.onrender.com/resgate/${deviceId}`;
  console.log(`\n======================================================`);
  console.log(`📱 SMS SIMULADO ENVIADO PARA A AMIGA:`);
  console.log(`"Alerta Guardião: A usuária não chegou em casa no horário combinado.`);
  console.log(`Por favor, acesse o painel urgente para verificar:`);
  console.log(`👉 ${linkResgate} "`);
  console.log(`======================================================\n`);
}

// ==========================================
// ROTAS DA API REST (Agora conectadas ao PostgreSQL)
// ==========================================

app.get('/health', (req, res) => res.status(200).json({ status: 'OK' }));

app.post('/auth/register', async (req: Request, res: Response) => {
  res.status(201).json({ message: 'Pronto para uso' });
});

app.post('/location/update', async (req: Request, res: Response) => {
  const { deviceId, latitude, longitude } = req.body;
  try {
    // Upsert corrigido: apenas id (o Prisma já sabe o que fazer)
    await prisma.device.upsert({
      where: { id: deviceId },
      update: {}, 
      create: { id: deviceId }
    });

    await prisma.location.create({
      data: { deviceId, latitude, longitude }
    });
    res.status(200).json({ message: 'Coordenadas salvas.' });
  } catch (error) {
    res.status(500).json({ error: 'Erro no banco.' });
  }
});

app.post('/timer/start', async (req: Request, res: Response) => {
  const { deviceId, durationTime, safeLat, safeLng, safeRadiusMeters } = req.body;

  try {
    await prisma.device.upsert({
      where: { id: deviceId },
      update: { status: 'SECURE' },
      create: { id: deviceId }
    });
  } catch (e) {
    console.error("Erro ao registrar no banco ao iniciar timer:", e);
  }

  if (mockDB.timers.has(deviceId)) { clearTimeout(mockDB.timers.get(deviceId)!); }

  console.log(`⏰ Timer iniciado para [${deviceId}]. Duração: ${durationTime}s`);
  const delayParaTestesMs = durationTime * 1000;

  const timerId = setTimeout(async () => {
    console.log(`\n⏳ O tempo de [${deviceId}] esgotou! Consultando banco de dados...`);

    try {
      // Busca a última localização registrada no Supabase
      const lastLocation = await prisma.location.findFirst({
        where: { deviceId },
        orderBy: { timestamp: 'desc' }
      });

      if (!lastLocation) {
        console.log(`🚨 PERIGO: Sem sinal de GPS registrado no banco.`);
        alertarContatoDeEmergencia(deviceId);
        return;
      }

      const distance = calcularDistanciaHaversine(safeLat, safeLng, lastLocation.latitude, lastLocation.longitude);
      console.log(`📏 Distância da zona segura: ${distance.toFixed(2)} metros`);

      if (distance <= safeRadiusMeters) {
        console.log(`✅ A usuária chegou no destino seguro. Cancelando alerta.\n`);
      } else {
        console.log(`🚨 PERIGO: Fora do raio seguro! Avisando Contato!`);
        alertarContatoDeEmergencia(deviceId);
      }
    } catch (error) {
      console.error("Erro ao verificar timer no banco:", error);
    } finally {
      mockDB.timers.delete(deviceId);
    }
  }, delayParaTestesMs);

  mockDB.timers.set(deviceId, timerId);
  res.status(200).json({ message: 'Timer ativado com sucesso.' });
});

app.post('/panic/trigger', async (req: Request, res: Response) => {
  const { deviceId, triggerType } = req.body;
  try {
    // Mapeamento correto para o seu Enum
    const statusAtual = (triggerType === "PIN_PANICO_IMEDIATO" || triggerType === "GATILHO_VOZ_OFFLINE") ? 'PANICO' : 'ALERTA';

    await prisma.device.upsert({
      where: { id: deviceId },
      update: { status: statusAtual },
      create: { id: deviceId, status: statusAtual }
    });

    await prisma.panicEvent.create({
      data: { deviceId, triggerType }
    });

    if (statusAtual === 'PANICO') {
      enviarComandoLockFCM(deviceId, triggerType);
    }
    res.status(200).json({ message: 'Pânico registrado.' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao registrar.' });
  }
});

// ==========================================
// O PAINEL DE RESGATE (Frontend Rápido)
// ==========================================

app.get('/resgate/:deviceId', async (req: Request, res: Response) => {
  const { deviceId } = req.params;

  try {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });

    if (!device) {
      return res.status(404).send("<h1 style='color:white;'>Link Expirado ou Inválido. Aparelho não encontrado.</h1>");
    }

    const lastLocation = await prisma.location.findFirst({
      where: { deviceId },
      orderBy: { timestamp: 'desc' }
    });

    const locText = lastLocation
      ? `Latitude: ${lastLocation.latitude} <br> Longitude: ${lastLocation.longitude} <br> <i>Última atualização: ${lastLocation.timestamp.toLocaleString()}</i>`
      : "Nenhuma coordenada registrada.";

    const htmlForm = `
          <html>
              <head>
                  <title>Guardião - Torre de Controle</title>
                  <style>
                      body { font-family: Arial, sans-serif; padding: 40px; background-color: #121212; color: white; text-align: center; }
                      .box { background-color: #1e1e1e; padding: 30px; border-radius: 10px; display: inline-block; box-shadow: 0 4px 6px rgba(0,0,0,0.5); }
                      .btn { padding: 15px 30px; border: none; border-radius: 5px; font-size: 16px; cursor: pointer; margin: 10px; font-weight: bold; }
                      .btn-safe { background-color: #4CAF50; color: white; }
                      .btn-danger { background-color: #f44336; color: white; }
                  </style>
              </head>
              <body>
                  <div class="box">
                      <h2 style="color: #ff9800;">⚠️ ALERTA DE SEGURANÇA</h2>
                      <p>O aparelho <b>${deviceId}</b> reportou perigo ou não retornou à base.</p>
                      <hr style="border-color: #333; margin: 20px 0;">
                      <p><b>Última localização registrada:</b></p>
                      <p style="color: #ccc;">${locText}</p>
                      <p>Tente ligar para a pessoa agora. Se não conseguir contato, confirme o Pânico abaixo para forçarmos o bloqueio do celular.</p>
                      <form action="/resgate/action" method="POST">
                          <input type="hidden" name="deviceId" value="${deviceId}">
                          <button type="submit" name="decisao" value="seguro" class="btn btn-safe">✅ Consegui falar. Está Segura.</button>
                          <button type="submit" name="decisao" value="panico" class="btn btn-danger">🚨 Não atende! CONFIRMAR PÂNICO</button>
                      </form>
                  </div>
              </body>
          </html>
      `;
    res.send(htmlForm);
  } catch (error) {
    res.status(500).send("Erro interno ao buscar dados.");
  }
});

app.post('/resgate/action', async (req: Request, res: Response) => {
  const { deviceId, decisao } = req.body;

  try {
    if (decisao === 'seguro') {
      await prisma.device.update({
        where: { id: deviceId },
        data: { status: 'SECURE' }
      });
      console.log(`\n🛡️ A amiga de [${deviceId}] confirmou segurança. Banco de dados atualizado.`);
      res.send("<h2 style='color:green; text-align:center; padding:50px; background-color:#121212;'>Obrigado! O alerta foi cancelado e a pessoa está segura.</h2>");
    } else if (decisao === 'panico') {
      await prisma.device.update({
        where: { id: deviceId },
        data: { status: 'PANICO' }
      });
      await prisma.panicEvent.create({
        data: { deviceId, triggerType: 'CONTATO_CONFIRMOU_RESGATE' }
      });

      console.log(`\n💀 A amiga de [${deviceId}] CONFIRMOU O PÂNICO! Gravado no BD.`);
      enviarComandoLockFCM(deviceId, "CONTATO_CONFIRMOU_RESGATE");

      res.send("<h2 style='color:red; text-align:center; padding:50px; background-color:#121212;'>PÂNICO CONFIRMADO! O Celular foi bloqueado. Entregue os dados à polícia.</h2>");
    }
  } catch (error) {
    console.error("Erro ao registrar ação de resgate:", error);
    res.status(500).send("Erro ao processar a requisição.");
  }
});

export default app;