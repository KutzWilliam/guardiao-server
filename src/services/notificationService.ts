import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface AlertaPayload {
  deviceId: string;
  triggerType: string;
}

/**
 * Dispara notificações em massa para todos os contatos de emergência do dispositivo
 * via Webhook do n8n (que aciona envio de SMS / WhatsApp).
 */
export async function alertarContatosDeEmergencia(deviceId: string, triggerType: string): Promise<void> {
  const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/guardiao-alerta';
  const publicUrl = process.env.PUBLIC_APP_URL || 'https://guardiao-public.onrender.com';
  const linkResgate = `${publicUrl}/resgate/${deviceId}`;

  try {
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      include: {
        contacts: true,
        user: { select: { name: true, phone: true } },
      },
    });

    if (!device) {
      console.warn(`⚠️ [NOTIF] Dispositivo ${deviceId} não encontrado para envio de alerta.`);
      return;
    }

    if (!device.contacts || device.contacts.length === 0) {
      console.warn(`⚠️ [NOTIF] Dispositivo ${deviceId} em pânico, mas nenhum contato de emergência cadastrado.`);
      return;
    }

    console.log(`🚨 [NOTIF] Disparando alerta (${triggerType}) para ${device.contacts.length} contato(s) do dispositivo ${deviceId}`);

    for (const contact of device.contacts) {
      try {
        await axios.post(N8N_WEBHOOK_URL, {
          contactPhone: contact.phone,
          contactName: contact.name,
          userName: device.user?.name || 'Seu contato',
          triggerType,
          rescueLink: linkResgate,
          deviceId,
          timestamp: new Date().toISOString(),
        });
        console.log(`✅ [NOTIF] Webhook n8n disparado com sucesso para ${contact.name} (${contact.phone})`);
      } catch (err: any) {
        console.error(`❌ [NOTIF] Falha ao disparar webhook para ${contact.name}: ${err.message}`);
      }
    }
  } catch (error) {
    console.error(`❌ [NOTIF] Erro ao orquestrar envio de alertas para ${deviceId}:`, error);
  }
}
