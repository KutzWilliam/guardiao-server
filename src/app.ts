import express, { Request, Response, NextFunction } from 'express';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import { PrismaClient } from '@prisma/client';
import authRoutes from './routes/auth.routes';
import { requireAuth, AuthRequest } from './middlewares/auth.middleware';

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

// FASE F - Segurança em Camadas
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// 1. Helmet: Protege contra XSS, Sniffing e configura dezenas de Headers HTTP seguros
app.use(helmet());

// 2. Rate Limiting Geral: Protege contra DDoS e Força Bruta
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // limite de 100 requisições por IP a cada 15 minutos
  message: { error: 'Muitas requisições originadas deste IP, por favor tente novamente mais tarde.' }
});
app.use(limiter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuração do multer para upload de arquivos em memória
const upload = multer({ storage: multer.memoryStorage() });

// Inicialização do cliente de Banco de Dados
const prisma = new PrismaClient();

// Prisma já inicializado acima

// ==========================================
// FUNÇÕES AUXILIARES
// ==========================================

/**
 * Calcula a distância em metros entre dois pontos geográficos.
 * Preservado aqui pois será reutilizado pelo futuro CronJob de auditoria de timers.
 */
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
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device || !device.fcmToken) {
      console.error(`❌ [${deviceId}] Falha ao enviar FCM: O dispositivo não possui um fcmToken cadastrado.`);
      return;
    }
    const mensagem = { data: { comando: "LOCK" }, token: device.fcmToken };
    const response = await admin.messaging().send(mensagem);
    console.log(`✅ Comando enviado com sucesso! ID: ${response}`);
  } catch (error) {
    console.error(`❌ Erro ao enviar FCM:`, error);
  }
}

/**
 * Alerta um contato de emergência com o link de resgate.
 * Preservado aqui pois será chamado pelo futuro CronJob de auditoria de timers.
 */
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
// ROTAS DA API REST
// ==========================================

app.get('/health', (req, res) => res.status(200).json({ status: 'OK' }));

app.use('/auth', authRoutes);

app.post('/location/update', requireAuth, async (req: AuthRequest, res: Response) => {
  const { deviceId, latitude, longitude } = req.body;
  const userId = req.user!.id;
  try {
    await prisma.device.upsert({
      where: { id: deviceId },
      update: { userId },
      create: { id: deviceId, userId }
    });

    await prisma.location.create({
      data: { deviceId, latitude, longitude }
    });
    res.status(200).json({ message: 'Coordenadas salvas.' });
  } catch (error) {
    res.status(500).json({ error: 'Erro no banco.' });
  }
});

// ==========================================
// SINCRONIZAÇÃO EM NUVEM (Geofences e Contatos)
// ==========================================

app.post('/sync/safezone', requireAuth, async (req: AuthRequest, res: Response) => {
  const { id, deviceId, name, latitude, longitude, radiusMeters } = req.body;
  const userId = req.user!.id;
  
  if (!id || !deviceId || !name || latitude == null || longitude == null || radiusMeters == null) {
    res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
    return;
  }

  try {
    // Garante que o dispositivo existe
    await prisma.device.upsert({
      where: { id: deviceId },
      update: { userId },
      create: { id: deviceId, userId }
    });

    const safeZone = await prisma.safeZone.upsert({
      where: { id },
      update: { name, latitude, longitude, radiusMeters, deviceId },
      create: { id, name, latitude, longitude, radiusMeters, deviceId }
    });
    
    return res.status(200).json({ message: 'SafeZone sincronizada com sucesso.', safeZone });
  } catch (error) {
    console.error('Erro no sync de safezone:', error);
    return res.status(500).json({ error: 'Erro interno ao sincronizar SafeZone.' });
  }
});

app.post('/sync/contact', requireAuth, async (req: AuthRequest, res: Response) => {
  const { id, deviceId, name, phone } = req.body;
  const userId = req.user!.id;
  
  if (!id || !deviceId || !name || !phone) {
    res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
    return;
  }

  try {
    // Garante que o dispositivo existe
    await prisma.device.upsert({
      where: { id: deviceId },
      update: { userId },
      create: { id: deviceId, userId }
    });

    const contact = await prisma.contact.upsert({
      where: { id },
      update: { name, phone, deviceId },
      create: { id, name, phone, deviceId }
    });
    
    return res.status(200).json({ message: 'Contato sincronizado com sucesso.', contact });
  } catch (error) {
    console.error('Erro no sync de contato:', error);
    return res.status(500).json({ error: 'Erro interno ao sincronizar Contato.' });
  }
});

app.post('/sync/fcm', requireAuth, async (req: AuthRequest, res: Response) => {
  const { deviceId, fcmToken } = req.body;
  const userId = req.user!.id;
  if (!deviceId || !fcmToken) {
    res.status(400).json({ error: 'deviceId e fcmToken são obrigatórios.' });
    return;
  }

  try {
    await prisma.device.upsert({
      where: { id: deviceId },
      update: { fcmToken, userId },
      create: { id: deviceId, fcmToken, userId }
    });
    return res.status(200).json({ message: 'FCM Token sincronizado.' });
  } catch (error) {
    console.error('Erro no sync do FCM Token:', error);
    return res.status(500).json({ error: 'Erro interno.' });
  }
});

// ==========================================
// ⏰ SMART TIMER — Arquitetura de Banco de Dados
// Nota: A lógica de disparo de alertas foi removida desta rota.
// Um CronJob externo será responsável por auditar os registros
// com isActive=true cujo targetTimestamp já passou.
// ==========================================

/**
 * POST /timer/start
 * Cria um registro de Timer persistente no banco de dados.
 *
 * Payload: {
 *   deviceId: string,
 *   eventName: string,
 *   targetTimestamp: string (ISO 8601, ex: "2026-08-04T23:00:00Z"),
 *   safeZoneId?: string (UUID de uma SafeZone já cadastrada, opcional),
 *   contactIds: string[] (UUIDs dos Contacts a notificar caso expire)
 * }
 */
app.post('/timer/start', requireAuth, async (req: AuthRequest, res: Response) => {
  const { deviceId, eventName, targetTimestamp, safeZoneId, contactIds } = req.body;
  const userId = req.user!.id;

  // Validação básica dos campos obrigatórios
  if (!deviceId || !eventName || !targetTimestamp) {
    res.status(400).json({
      error: 'Campos obrigatórios ausentes: deviceId, eventName, targetTimestamp.'
    });
    return;
  }

  const parsedTimestamp = new Date(targetTimestamp);
  if (isNaN(parsedTimestamp.getTime())) {
    res.status(400).json({ error: 'targetTimestamp inválido. Use o formato ISO 8601.' });
    return;
  }

  if (parsedTimestamp <= new Date()) {
    res.status(400).json({ error: 'targetTimestamp deve ser uma data futura.' });
    return;
  }

  try {
    // Garante que o dispositivo existe no banco antes de criar o timer
    await prisma.device.upsert({
      where: { id: deviceId },
      update: { userId },
      create: { id: deviceId, userId }
    });

    // Monta o bloco de conexão N:M com os contatos (se fornecidos)
    const contactsConnect = Array.isArray(contactIds) && contactIds.length > 0
      ? { connect: contactIds.map((id: string) => ({ id })) }
      : undefined;

    // Monta a conexão opcional com a SafeZone
    const safeZoneConnect = safeZoneId
      ? { connect: { id: safeZoneId } }
      : undefined;

    // Cria o Timer no banco — a partir daqui, o CronJob é responsável por auditar
    const timer = await prisma.timer.create({
      data: {
        eventName,
        targetTimestamp: parsedTimestamp,
        device: { connect: { id: deviceId } },
        safeZone: safeZoneConnect,
        contacts: contactsConnect,
      },
      include: {
        safeZone: true,
        contacts: { select: { id: true, name: true, phone: true } },
      },
    });

    console.log(`⏰ [${deviceId}] Timer criado no banco. Evento: "${eventName}", Expira em: ${parsedTimestamp.toISOString()}`);

    return res.status(201).json({
      message: 'Timer criado com sucesso. O CronJob irá auditar no momento certo.',
      timer,
    });
  } catch (error: any) {
    // Captura erro de FK inválida (safeZoneId ou contactIds inexistentes)
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'SafeZone ou Contact não encontrado. Verifique os IDs.' });
    }
    console.error("Erro ao criar timer:", error);
    return res.status(500).json({ error: 'Erro interno ao criar o timer.' });
  }
});

/**
 * POST /timer/checkin
 * Realiza o check-in manual da usuária, desarmando o timer.
 * Isso indica que ela chegou ao destino ou está segura no momento combinado.
 *
 * Payload: { deviceId: string, timerId: number }
 */
app.post('/timer/checkin', requireAuth, async (req: AuthRequest, res: Response) => {
  const { deviceId, timerId } = req.body;

  if (!deviceId || !timerId) {
    res.status(400).json({ error: 'Campos obrigatórios ausentes: deviceId, timerId.' });
    return;
  }

  try {
    // Busca o timer verificando simultaneamente que ele pertence ao deviceId correto
    const timer = await prisma.timer.findFirst({
      where: {
        id: Number(timerId),
        deviceId,
      },
    });

    if (!timer) {
      // Retorna 403 para não revelar se o timerId existe mas pertence a outro device
      return res.status(403).json({
        error: 'Timer não encontrado ou este dispositivo não tem permissão para fazer check-in nele.',
      });
    }

    if (!timer.isActive) {
      return res.status(409).json({
        error: 'Este timer já foi encerrado (check-in realizado ou expiração já processada).',
      });
    }

    // Desativa o timer: bomba-relógio desarmada ✅
    const updatedTimer = await prisma.timer.update({
      where: { id: Number(timerId) },
      data: {
        checkedIn: true,
        isActive: false,
      },
    });

    console.log(`✅ [${deviceId}] Check-in realizado para o timer #${timerId} ("${updatedTimer.eventName}"). Alarme desarmado.`);

    return res.status(200).json({
      message: 'Check-in realizado com sucesso. Alarme desarmado.',
      timer: updatedTimer,
    });
  } catch (error) {
    console.error("Erro ao realizar check-in:", error);
    return res.status(500).json({ error: 'Erro interno ao realizar check-in.' });
  }
});

app.post('/panic/trigger', requireAuth, async (req: AuthRequest, res: Response) => {
  const { deviceId, triggerType } = req.body;
  const userId = req.user!.id;
  try {
    const statusAtual = (triggerType === "PIN_PANICO_IMEDIATO" || triggerType === "GATILHO_VOZ_OFFLINE") ? 'PANICO' : 'ALERTA';

    await prisma.device.upsert({
      where: { id: deviceId },
      update: { status: statusAtual, userId },
      create: { id: deviceId, status: statusAtual, userId }
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

app.post('/panic/unlock/biometrics', requireAuth, async (req: AuthRequest, res: Response) => {
  const { deviceId } = req.body;
  const userId = req.user!.id;

  try {
    const device = await prisma.device.findFirst({ where: { id: deviceId, userId } });
    if (!device) {
      res.status(403).json({ error: 'Acesso negado.' });
      return;
    }

    await prisma.device.update({
      where: { id: deviceId },
      data: { status: 'SECURE' }
    });

    await prisma.panicEvent.updateMany({
      where: { deviceId, resolved: false },
      data: { resolved: true }
    });

    res.status(200).json({ message: 'Pânico desativado via biometria com sucesso.' });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno ao desativar pânico.' });
  }
});

app.post('/panic/unlock/request', upload.single('selfie'), async (req: Request, res: Response) => {
  const { email, password, cpf } = req.body;
  const selfie = req.file;

  if (!email || !password || !cpf || !selfie) {
    res.status(400).json({ error: 'Todos os campos e a selfie são obrigatórios.' });
    return;
  }

  try {
    const user = await prisma.user.findFirst({ where: { email, cpf } });
    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado com estes dados.' });
      return;
    }

    // Cria a requisição (Numa implementação real, fariamos upload pro Supabase aqui)
    await prisma.unlockRequest.create({
      data: {
        userId: user.id,
        status: 'PENDING',
        selfieUrl: 'https://placeholder.com/selfie.jpg', // Temporário para MVP
      }
    });

    res.status(201).json({ message: 'Solicitação criada.' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar solicitação.' });
  }
});

// ==========================================
// O PAINEL DE RESGATE (API para guardiao-public)
// ==========================================

app.get('/resgate/info/:deviceId', async (req: Request, res: Response) => {
  const { deviceId } = req.params;

  try {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) {
      res.status(404).json({ error: 'Aparelho não encontrado.' });
      return;
    }

    const lastLocation = await prisma.location.findFirst({
      where: { deviceId },
      orderBy: { timestamp: 'desc' }
    });

    res.status(200).json({ device, lastLocation });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

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

      res.status(200).json({ message: 'PÂNICO CONFIRMADO!' });
    }
  } catch (error) {
    console.error("Erro ao registrar ação de resgate:", error);
    res.status(500).json({ error: "Erro ao processar a requisição." });
  }
});

// ==========================================
// 🛡️ ADMIN API — Torre de Controle
// Todas as rotas abaixo exigem o header X-Admin-Key.
// NUNCA exponha a chave ADMIN_API_KEY no cliente.
// ==========================================

function verificarAdminKey(req: Request, res: Response, next: NextFunction) {
  const chave = req.headers['x-admin-key'];
  const chaveEsperada = process.env.ADMIN_API_KEY;

  // Rejeita se a chave não está configurada no servidor (ambiente inválido)
  if (!chaveEsperada) {
    console.error('❌ [ADMIN] ADMIN_API_KEY não configurada no ambiente do servidor!');
    return res.status(503).json({ error: 'Serviço admin não configurado.' });
  }

  if (!chave || chave !== chaveEsperada) {
    console.warn(`⚠️ [ADMIN] Tentativa de acesso admin não autorizada. IP: ${req.ip}`);
    return res.status(401).json({ error: 'Não autorizado.' });
  }

  next();
}

// Valida UUID v4 para evitar SQL injection ou enumeração de IDs
function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

/**
 * GET /admin/devices
 * Retorna todos os dispositivos com resumo de status, última localização e pânico ativo.
 */
app.get('/admin/devices', verificarAdminKey, async (req: Request, res: Response) => {
  try {
    const devices = await prisma.device.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        locations: { orderBy: { timestamp: 'desc' }, take: 1 },
        panics:    { where: { resolved: false }, orderBy: { timestamp: 'desc' }, take: 1 },
        timers:    { where: { isActive: true } },
      },
    });
    res.json(devices);
  } catch (error) {
    console.error('[ADMIN] Erro ao listar devices:', error);
    res.status(500).json({ error: 'Erro interno ao listar dispositivos.' });
  }
});

/**
 * GET /admin/devices/:deviceId
 * Retorna dados completos do dispositivo: localização, timers ativos, pânicos, contatos e zonas.
 */
app.get('/admin/devices/:deviceId', verificarAdminKey, async (req: Request, res: Response) => {
  const { deviceId } = req.params;

  if (!isValidUUID(deviceId)) {
    return res.status(400).json({ error: 'ID de dispositivo inválido.' });
  }

  try {
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      include: {
        locations: { orderBy: { timestamp: 'desc' }, take: 1 },
        panics:    { where: { resolved: false }, orderBy: { timestamp: 'desc' } },
        timers:    { where: { isActive: true }, include: { safeZone: true, contacts: true } },
        contacts:  true,
        safeZones: true,
      },
    });

    if (!device) {
      return res.status(404).json({ error: 'Dispositivo não encontrado.' });
    }

    // Nunca expõe o fcmToken para o frontend
    const { fcmToken: _removed, ...deviceSafe } = device as any;
    res.json(deviceSafe);
  } catch (error) {
    console.error('[ADMIN] Erro ao buscar device:', error);
    res.status(500).json({ error: 'Erro interno ao buscar dispositivo.' });
  }
});

/**
 * POST /admin/devices/:deviceId/resolve
 * Cancela o alarme: define status SECURE e resolve todos os PanicEvents pendentes.
 */
app.post('/admin/devices/:deviceId/resolve', verificarAdminKey, async (req: Request, res: Response) => {
  const { deviceId } = req.params;

  if (!isValidUUID(deviceId)) {
    return res.status(400).json({ error: 'ID de dispositivo inválido.' });
  }

  try {
    await prisma.device.update({
      where: { id: deviceId },
      data: { status: 'SECURE' },
    });

    const { count } = await prisma.panicEvent.updateMany({
      where: { deviceId, resolved: false },
      data: { resolved: true },
    });

    console.log(`🛡️ [ADMIN] Alarme de [${deviceId}] cancelado. ${count} PanicEvent(s) resolvido(s).`);
    res.json({ message: 'Alarme cancelado com sucesso.', resolvedPanics: count });
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Dispositivo não encontrado.' });
    }
    console.error('[ADMIN] Erro ao resolver alarme:', error);
    res.status(500).json({ error: 'Erro interno ao cancelar alarme.' });
  }
});

/**
 * POST /admin/devices/:deviceId/panic
 * Força o bloqueio: define status PANICO, cria PanicEvent e envia FCM Lock.
 */
app.post('/admin/devices/:deviceId/panic', verificarAdminKey, async (req: Request, res: Response) => {
  const { deviceId } = req.params;

  if (!isValidUUID(deviceId)) {
    return res.status(400).json({ error: 'ID de dispositivo inválido.' });
  }

  try {
    const device = await prisma.device.update({
      where: { id: deviceId },
      data: { status: 'PANICO' },
    });

    await prisma.panicEvent.create({
      data: { deviceId, triggerType: 'ADMIN_FORCED_PANIC' },
    });

    // Dispara FCM usando o token real do device (se disponível)
    console.log(`💀 [ADMIN] Bloqueio forçado para [${deviceId}] pelo painel admin.`);
    if (!device.fcmToken) {
      console.warn(`⚠️ [ADMIN] Dispositivo [${deviceId}] não possui FCM Token. O bloqueio ocorrerá apenas na próxima sincronização do app.`);
    } else {
      try {
        const fcmResponse = await admin.messaging().send({ data: { comando: 'LOCK' }, token: device.fcmToken });
        console.log(`✅ [ADMIN] FCM LOCK enviado. ID: ${fcmResponse}`);
      } catch (fcmError) {
        console.error(`❌ [ADMIN] Falha no FCM (device pode estar offline):`, fcmError);
      }
    }

    res.json({ message: 'Bloqueio forçado ativado.' });
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Dispositivo não encontrado.' });
    }
    console.error('[ADMIN] Erro ao forçar pânico:', error);
    res.status(500).json({ error: 'Erro interno ao forçar bloqueio.' });
  }
});

export default app;