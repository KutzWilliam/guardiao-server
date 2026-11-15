import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface AlertaPayload {
  deviceId: string;
  triggerType: string;
}

/**
 * Dispara notificações em massa para todos os contatos de emergência do dispositivo
 * via Webhook do n8n (que aciona envio de SMS / WhatsApp via WAHA / Twilio)
 * e possui fallback direto para WAHA caso configurado.
 */
export async function alertarContatosDeEmergencia(
  deviceId: string,
  triggerType: string,
  eventName?: string
): Promise<void> {
  const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/guardiao-alerta';
  const WAHA_API_URL = process.env.WAHA_API_URL; // Opcional: fallback direto para container WAHA
  const publicUrl = process.env.PUBLIC_APP_URL || 'https://guardiao-public.onrender.com';
  const linkResgate = `${publicUrl}/resgate/${deviceId}`;
  const linkDossie = `${publicUrl}/resgate/${deviceId}?dossier=1`;

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

    const userName = device.user?.name || 'Seu contato';
    console.log(`🚨 [NOTIF] Disparando alerta (${triggerType}) para ${device.contacts.length} contato(s) do dispositivo ${deviceId}`);

    for (const contact of device.contacts) {
      const payload = {
        contactPhone: contact.phone,
        contactName: contact.name,
        userName,
        triggerType,
        eventName: eventName || triggerType,
        rescueLink: linkResgate,
        dossierLink: linkDossie,
        deviceId,
        timestamp: new Date().toISOString(),
      };

      try {
        await axios.post(N8N_WEBHOOK_URL, payload);
        console.log(`✅ [NOTIF] Webhook n8n disparado com sucesso para ${contact.name} (${contact.phone})`);
      } catch (err: any) {
        console.error(`❌ [NOTIF] Falha ao disparar webhook n8n para ${contact.name}: ${err.message}`);

        // Fallback direto para WAHA WhatsApp API se estiver configurada
        if (WAHA_API_URL) {
          try {
            const cleanPhone = contact.phone.replace(/\D/g, '');
            const chatId = `${cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`}@c.us`;
            const text =
              `🚨 *ALERTA URGENTE GUARDIÃO*\n\n` +
              `Olá ${contact.name}, *${userName}* acionou o protocolo de emergência (${triggerType}).\n\n` +
              `📍 *Acompanhe a rota ao vivo e acione o bloqueio:*\n${linkResgate}\n\n` +
              `📄 *Dossiê Policial:*\n${linkDossie}`;
            await axios.post(`${WAHA_API_URL}/api/sendText`, {
              session: 'default',
              chatId,
              text,
            });
            console.log(`✅ [NOTIF] Fallback WAHA enviado diretamente para ${contact.name}`);
          } catch (wahaErr: any) {
            console.error(`❌ [NOTIF] Falha no fallback WAHA: ${wahaErr.message}`);
          }
        }
      }
    }
  } catch (error) {
    console.error(`❌ [NOTIF] Erro ao orquestrar envio de alertas para ${deviceId}:`, error);
  }
}
