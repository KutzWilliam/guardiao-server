import './mockPrisma';
import { mockPrisma } from './mockPrisma';
import axios from 'axios';
import { alertarContatosDeEmergencia } from '../src/services/notificationService';
import { uploadSelfie } from '../src/services/supabaseStorage';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('External Integration Services (SMS/N8N & Supabase Storage)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('NotificationService (N8N Webhook)', () => {
    it('deve disparar webhook para cada contato de emergência do dispositivo', async () => {
      mockPrisma.device.findUnique.mockResolvedValue({
        id: 'device-test',
        user: { name: 'João Santos', phone: '11988887777' },
        contacts: [
          { id: 'contact-1', name: 'Ana', phone: '11999990001' },
          { id: 'contact-2', name: 'Carlos', phone: '11999990002' },
        ],
      });

      mockedAxios.post.mockResolvedValue({ status: 200, data: { ok: true } });

      await alertarContatosDeEmergencia('device-test', 'GATILHO_VOZ_OFFLINE');

      expect(mockPrisma.device.findUnique).toHaveBeenCalledWith({
        where: { id: 'device-test' },
        include: {
          contacts: true,
          user: { select: { name: true, phone: true } },
        },
      });

      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          contactPhone: '11999990001',
          contactName: 'Ana',
          userName: 'João Santos',
          triggerType: 'GATILHO_VOZ_OFFLINE',
          deviceId: 'device-test',
        })
      );
    });

    it('não deve quebrar se o dispositivo não possuir contatos', async () => {
      mockPrisma.device.findUnique.mockResolvedValue({
        id: 'device-sem-contatos',
        user: { name: 'Sem Contatos', phone: '11900000000' },
        contacts: [],
      });

      await alertarContatosDeEmergencia('device-sem-contatos', 'PIN_PANICO_IMEDIATO');

      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });

  describe('SupabaseStorage Service', () => {
    it('deve retornar URL de selfie para o usuário', async () => {
      const mockFile: any = {
        buffer: Buffer.from('fake-image-bytes'),
        mimetype: 'image/jpeg',
        originalname: 'rosto.jpg',
      };

      const resultUrl = await uploadSelfie('user-abc-123', mockFile);

      expect(resultUrl).toBeDefined();
      expect(typeof resultUrl).toBe('string');
      expect(resultUrl).toContain('user-abc-123');
    });
  });
});
