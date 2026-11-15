import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export const DEMO_DEVICE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

async function main() {
  console.log('🌱 Iniciando seed de dados executivos para a Demonstração ao Investidor...');

  const passwordHash = await bcrypt.hash('Demo@2026', 10);
  const adminPassHash = await bcrypt.hash('admin123', 10);

  // 1. Admin da Torre de Controle (suporta login por email "admin@guardiao.app" ou "admin")
  await prisma.admin.upsert({
    where: { email: 'admin@guardiao.app' },
    update: { passwordHash: adminPassHash, name: 'Comandante Torre Guardião', role: 'ADMIN' },
    create: {
      name: 'Comandante Torre Guardião',
      email: 'admin@guardiao.app',
      passwordHash: adminPassHash,
      role: 'ADMIN',
    },
  });

  // 2. Usuária Executiva de Demonstração (Mariana Costa)
  const user = await prisma.user.upsert({
    where: { email: 'mariana.costa@guardiao.app' },
    update: {
      name: 'Mariana Costa (Executiva Piloto)',
      phone: '+5542999887766',
      city: 'Curitiba / Ponta Grossa - PR',
      pinSeguro: '1234',
      pinTeatro: '5555',
      pinEmergencia: '9999',
      emergencyNote: 'Tipo Sanguíneo O+. Veículo: Jeep Compass Cinza (Placa BDC-4A89). Condomínio Batel.',
    },
    create: {
      name: 'Mariana Costa (Executiva Piloto)',
      cpf: '12345678909',
      email: 'mariana.costa@guardiao.app',
      phone: '+5542999887766',
      city: 'Curitiba / Ponta Grossa - PR',
      passwordHash,
      pinSeguro: '1234',
      pinTeatro: '5555',
      pinEmergencia: '9999',
      emergencyNote: 'Tipo Sanguíneo O+. Veículo: Jeep Compass Cinza (Placa BDC-4A89). Condomínio Batel.',
      emailVerified: true,
    },
  });

  // 3. Dispositivo Principal em Monitoramento
  const device = await prisma.device.upsert({
    where: { id: DEMO_DEVICE_ID },
    update: {
      userId: user.id,
      status: 'PANICO',
    },
    create: {
      id: DEMO_DEVICE_ID,
      userId: user.id,
      status: 'PANICO',
      fcmToken: 'demo-fcm-token-investidor-v3',
    },
  });

  // 4. Contatos de Confiança
  await prisma.contact.deleteMany({ where: { deviceId: device.id } });
  const c1 = await prisma.contact.create({
    data: {
      deviceId: device.id,
      name: 'Carlos Eduardo (Marido)',
      phone: '+5542991112233',
    },
  });
  const c2 = await prisma.contact.create({
    data: {
      deviceId: device.id,
      name: 'Dra. Helena (Segurança Corporativa)',
      phone: '+5542994445566',
    },
  });

  // 5. Zonas Seguras (Geofencing)
  await prisma.safeZone.deleteMany({ where: { deviceId: device.id } });
  const sz = await prisma.safeZone.create({
    data: {
      deviceId: device.id,
      name: 'Residência — Centro (Ponta Grossa / Curitiba)',
      latitude: -25.0945,
      longitude: -50.1633,
      radiusMeters: 250,
    },
  });

  // 6. Trilha de Rastro GPS (trajeto realista)
  await prisma.location.deleteMany({ where: { deviceId: device.id } });
  const now = Date.now();
  const routePoints = [
    { lat: -25.0945, lng: -50.1633, offsetSec: -240 },
    { lat: -25.0938, lng: -50.1619, offsetSec: -180 },
    { lat: -25.0929, lng: -50.1602, offsetSec: -120 },
    { lat: -25.0918, lng: -50.1588, offsetSec: -60 },
    { lat: -25.0909, lng: -50.1574, offsetSec: 0 },
  ];
  for (const pt of routePoints) {
    await prisma.location.create({
      data: {
        deviceId: device.id,
        latitude: pt.lat,
        longitude: pt.lng,
        timestamp: new Date(now + pt.offsetSec * 1000),
      },
    });
  }

  // 7. Evento de Pânico Ativo e Smart Timer com Nota de Emergência
  await prisma.panicEvent.deleteMany({ where: { deviceId: device.id } });
  await prisma.panicEvent.create({
    data: {
      deviceId: device.id,
      triggerType: 'PIN_PANICO_IMEDIATO',
      resolved: false,
    },
  });

  await prisma.timer.deleteMany({ where: { deviceId: device.id } });
  await prisma.timer.create({
    data: {
      deviceId: device.id,
      eventName: 'Retorno Jantar Executivo — Veículo Suspeito Próximo',
      targetTimestamp: new Date(now + 10 * 60 * 1000),
      isActive: true,
      safeZoneId: sz.id,
      contacts: {
        connect: [{ id: c1.id }, { id: c2.id }],
      },
    },
  });

  // 8. Pedido de Desbloqueio Remoto (Selfie) para demonstração na Torre de Controle
  await prisma.unlockRequest.deleteMany({ where: { userId: user.id } });
  await prisma.unlockRequest.create({
    data: {
      userId: user.id,
      status: 'PENDING',
      selfieUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=600&auto=format&fit=crop&q=80',
      adminNote: 'Solicitação de desbloqueio biométrico enviada pelo Portal de Emergência.',
    },
  });

  // 9. Configurar Realtime e Bucket de Selfies no Supabase (se conectado ao Supabase)
  try {
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE "Location";
      EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END $$;
    `);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE "Device";
      EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END $$;
    `);
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE "PanicEvent";
      EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END $$;
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO storage.buckets (id, name, public)
      VALUES ('guardiao-selfies', 'guardiao-selfies', true)
      ON CONFLICT (id) DO UPDATE SET public = true;
    `);
    console.log('⚡ Supabase Realtime (Location, Device, PanicEvent) e Bucket guardiao-selfies configurados!');
  } catch {
    // Ignora silenciosamente se estiver rodando em Postgres local sem extensões Supabase
  }

  console.log('✅ Seed concluído com sucesso!');
  console.log(`👤 Usuária Demo: mariana.costa@guardiao.app (Senha: Demo@2026 | PIN Seguro: 1234 | PIN Teatro: 5555 | PIN Pânico: 9999)`);
  console.log(`📱 Device ID de Demonstração: ${DEMO_DEVICE_ID}`);
  console.log(`🔗 Link Público de Resgate: http://localhost:5173/resgate/${DEMO_DEVICE_ID}`);
  console.log(`🛡️ Link Torre de Controle:  http://localhost:3001/rescue/${DEMO_DEVICE_ID}`);
}

main()
  .catch((e) => {
    console.error('❌ Erro ao executar seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
