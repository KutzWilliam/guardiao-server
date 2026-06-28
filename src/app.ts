import express, { Request, Response } from 'express';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

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

const MEU_TOKEN_FCM = "dWVHc4_GRf2JlqVNwP5fj7:APA91bHpUMdAaxNzqEZ0RnEL8XH0W75lew48rhZBVJQYrNppSZZXE4Y8__zoCxuii2ldCM2SiFypLdTcQXr7O5J50ETU7SmVSSkQWI93MK3Db0tGw8YaZEc";

const mockDB = {
  devices: new Map<string, any>(),
  panicEvents: [] as any[],
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

// Simula o envio de um SMS para o contato de emergência
function alertarContatoDeEmergencia(deviceId: string) {
  const linkResgate = `http://localhost:3000/resgate/${deviceId}`;
  console.log(`\n======================================================`);
  console.log(`📱 SMS SIMULADO ENVIADO PARA A AMIGA:`);
  console.log(`"Alerta Guardião: Mariana não chegou em casa no horário combinado.`);
  console.log(`Por favor, acesse o painel urgente para verificar:`);
  console.log(`👉 ${linkResgate} "`);
  console.log(`======================================================\n`);
}

// ==========================================
// ROTAS DA API REST 
// ==========================================

app.get('/health', (req, res) => res.status(200).json({ status: 'OK' }));

app.post('/auth/register', (req, res) => {
  res.status(201).json({ message: 'Registrado com sucesso' });
});

app.post('/location/update', (req: Request, res: Response) => {
  const { deviceId, latitude, longitude } = req.body;
  if (!mockDB.devices.has(deviceId)) { mockDB.devices.set(deviceId, { deviceModel: 'Celular', status: 'SECURE' }); }
  const device = mockDB.devices.get(deviceId);
  device.lastLocation = { latitude, longitude, timestamp: new Date() };
  console.log(`📍 Localização Atualizada [${deviceId}]: Lat ${latitude}, Lng ${longitude}`);
  res.status(200).json({ message: 'Coordenadas salvas.' });
});

app.post('/timer/start', (req: Request, res: Response) => {
  const { deviceId, durationTime, safeLat, safeLng, safeRadiusMeters } = req.body;
  if (!mockDB.devices.has(deviceId)) { mockDB.devices.set(deviceId, { deviceModel: 'Celular', status: 'SECURE' }); }
  if (mockDB.timers.has(deviceId)) { clearTimeout(mockDB.timers.get(deviceId)!); }

  console.log(`⏰ Timer iniciado para [${deviceId}].`);
  const delayParaTestesMs = durationTime * 1000;

  const timerId = setTimeout(() => {
    console.log(`\n⏳ O tempo de [${deviceId}] esgotou! Analisando contexto...`);
    const device = mockDB.devices.get(deviceId);

    if (!device || !device.lastLocation) {
      console.log(`🚨 PERIGO: Sem sinal de GPS recente.`);
      // Em vez de bloquear direto, delegamos a decisão para o contato!
      alertarContatoDeEmergencia(deviceId);
      return;
    }

    const distance = calcularDistanciaHaversine(safeLat, safeLng, device.lastLocation.latitude, device.lastLocation.longitude);
    console.log(`📏 Distância da zona segura: ${distance.toFixed(2)} metros`);

    if (distance <= safeRadiusMeters) {
      console.log(`✅ A usuária chegou no destino seguro. Cancelando alerta silenciosamente.\n`);
    } else {
      console.log(`🚨 PERIGO: Fora do raio seguro! Avisando o Contato de Segurança!`);
      // O servidor não ataca mais sozinho. Ele avisa a amiga!
      alertarContatoDeEmergencia(deviceId);
    }
    mockDB.timers.delete(deviceId);
  }, delayParaTestesMs);

  mockDB.timers.set(deviceId, timerId);
  res.status(200).json({ message: 'Timer ativado com sucesso.' });
});

app.post('/panic/trigger', (req: Request, res: Response) => {
  const { deviceId, triggerType } = req.body;
  if (!mockDB.devices.has(deviceId)) { mockDB.devices.set(deviceId, { deviceModel: 'Celular', status: 'SECURE' }); }
  mockDB.panicEvents.push({ deviceId, triggerType, time: new Date() });
  console.log(`\n🚨 ALERTA MANUAL RECEBIDO! Device: ${deviceId} | Gatilho: ${triggerType}`);
  if (triggerType !== "PIN_MODO_DEGRADADO") { enviarComandoLockFCM(deviceId, triggerType); }
  res.status(200).json({ message: 'Pânico registrado.' });
});

// ==========================================
// O PAINEL DE RESGATE (Para a amiga acessar)
// ==========================================

// Renderiza a página HTML
app.get('/resgate/:deviceId', (req: Request, res: Response) => {
  const { deviceId } = req.params;
  const device = mockDB.devices.get(deviceId);

  if (!device) {
    return res.status(404).send("<h1>Link Expirado ou Inválido.</h1>");
  }

  const loc = device.lastLocation ? `Latitude: ${device.lastLocation.latitude} <br> Longitude: ${device.lastLocation.longitude}` : "Desconhecida";

  const htmlForm = `
        <html>
            <head>
                <title>Guardião - Resgate</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 40px; background-color: #121212; color: white; text-align: center; }
                    .box { background-color: #1e1e1e; padding: 30px; border-radius: 10px; display: inline-block; }
                    .btn { padding: 15px 30px; border: none; border-radius: 5px; font-size: 16px; cursor: pointer; margin: 10px; font-weight: bold; }
                    .btn-safe { background-color: #4CAF50; color: white; }
                    .btn-danger { background-color: #f44336; color: white; }
                </style>
            </head>
            <body>
                <div class="box">
                    <h2 style="color: #ff9800;">⚠️ ALERTA DE SEGURANÇA</h2>
                    <p>O aparelho <b>${deviceId}</b> não retornou para a base no horário combinado.</p>
                    <hr style="border-color: #333; margin: 20px 0;">
                    <p><b>Última localização registrada:</b></p>
                    <p style="color: #ccc;">${loc}</p>
                    <p>Tente ligar para a pessoa agora. Se não conseguir contato, confirme o Pânico abaixo para bloquearmos o celular.</p>
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
});

// Processa o clique do botão da amiga
app.post('/resgate/action', (req: Request, res: Response) => {
  const { deviceId, decisao } = req.body;

  if (decisao === 'seguro') {
    console.log(`\n🛡️ A amiga de [${deviceId}] confirmou segurança. Alerta falso. Vida que segue.`);
    res.send("<h2 style='color:green; text-align:center; padding:50px;'>Obrigado! O alerta foi cancelado e a pessoa está segura.</h2>");
  } else if (decisao === 'panico') {
    console.log(`\n💀 A amiga de [${deviceId}] CONFIRMOU O PÂNICO! O bicho pegou.`);
    enviarComandoLockFCM(deviceId, "CONTATO_CONFIRMOU_RESGATE");

    // Aqui o servidor geraria o Dossiê para a Polícia
    res.send("<h2 style='color:red; text-align:center; padding:50px;'>PÂNICO CONFIRMADO! O Celular foi bloqueado. Leve as coordenadas exibidas na tela anterior para a polícia.</h2>");
  }
});

export default app;