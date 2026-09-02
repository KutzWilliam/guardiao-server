import './mockPrisma';
import { mockPrisma } from './mockPrisma';
import request from 'supertest';
import app from '../src/app';

const ADMIN_KEY = 'minha_chave_mestra_ultra_secreta_123';
process.env.ADMIN_API_KEY = ADMIN_KEY;
const VALID_UUID = '43af0407-93c8-48e9-b13b-fccb07e37384';

describe('Admin Tower Control Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /admin/devices', () => {
    it('deve listar todos os dispositivos com status e localizações com a chave correta', async () => {
      mockPrisma.device.findMany.mockResolvedValue([
        {
          id: VALID_UUID,
          status: 'SECURE',
          locations: [{ latitude: -23.55, longitude: -46.63, timestamp: new Date() }],
          panics: [],
          timers: [],
        },
      ]);

      const res = await request(app)
        .get('/admin/devices')
        .set('X-Admin-Key', ADMIN_KEY);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].id).toBe(VALID_UUID);
      expect(res.body[0].status).toBe('SECURE');
    });

    it('deve rejeitar requisição sem a chave X-Admin-Key', async () => {
      const res = await request(app).get('/admin/devices');
      expect(res.status).toBe(401);
    });

    it('deve rejeitar requisição com chave X-Admin-Key incorreta', async () => {
      const res = await request(app)
        .get('/admin/devices')
        .set('X-Admin-Key', 'chave-invalida-hacker');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /admin/devices/:deviceId', () => {
    it('deve retornar detalhes de um dispositivo válido sem expor o fcmToken', async () => {
      mockPrisma.device.findUnique.mockResolvedValue({
        id: VALID_UUID,
        status: 'PANICO',
        fcmToken: 'secret-fcm-token',
        locations: [],
        panics: [],
        timers: [],
        contacts: [],
        safeZones: [],
      });

      const res = await request(app)
        .get(`/admin/devices/${VALID_UUID}`)
        .set('X-Admin-Key', ADMIN_KEY);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(VALID_UUID);
      expect(res.body.fcmToken).toBeUndefined(); // fcmToken nunca deve vazar pro front
    });

    it('deve rejeitar deviceId que não seja um UUID v4 válido', async () => {
      const res = await request(app)
        .get('/admin/devices/123-invalid-id-or-sql-injection')
        .set('X-Admin-Key', ADMIN_KEY);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/inválido/i);
    });
  });

  describe('POST /admin/devices/:deviceId/panic', () => {
    it('deve forçar modo de pânico no dispositivo', async () => {
      mockPrisma.device.update.mockResolvedValue({
        id: VALID_UUID,
        status: 'PANICO',
        fcmToken: null,
      });
      mockPrisma.panicEvent.create.mockResolvedValue({
        id: 1,
        deviceId: VALID_UUID,
        triggerType: 'ADMIN_FORCED_PANIC',
      });

      const res = await request(app)
        .post(`/admin/devices/${VALID_UUID}/panic`)
        .set('X-Admin-Key', ADMIN_KEY);

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/Bloqueio forçado/i);
      expect(mockPrisma.device.update).toHaveBeenCalledWith({
        where: { id: VALID_UUID },
        data: { status: 'PANICO' },
      });
      expect(mockPrisma.panicEvent.create).toHaveBeenCalledWith({
        data: { deviceId: VALID_UUID, triggerType: 'ADMIN_FORCED_PANIC' },
      });
    });
  });

  describe('POST /admin/devices/:deviceId/resolve', () => {
    it('deve cancelar o alarme e marcar o status como SECURE', async () => {
      mockPrisma.device.update.mockResolvedValue({
        id: VALID_UUID,
        status: 'SECURE',
      });
      mockPrisma.panicEvent.updateMany.mockResolvedValue({ count: 2 });

      const res = await request(app)
        .post(`/admin/devices/${VALID_UUID}/resolve`)
        .set('X-Admin-Key', ADMIN_KEY);

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/Alarme cancelado/i);
      expect(res.body.resolvedPanics).toBe(2);
      expect(mockPrisma.device.update).toHaveBeenCalledWith({
        where: { id: VALID_UUID },
        data: { status: 'SECURE' },
      });
    });
  });
});
