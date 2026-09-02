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

  describe('GET /admin/devices/:deviceId/locations', () => {
    it('deve retornar o histórico de localizações para um dispositivo válido', async () => {
      const mockLocations = [
        { id: 1, latitude: -23.55, longitude: -46.63, timestamp: new Date(), deviceId: VALID_UUID },
        { id: 2, latitude: -23.56, longitude: -46.64, timestamp: new Date(), deviceId: VALID_UUID },
      ];
      mockPrisma.location.findMany.mockResolvedValue(mockLocations);

      const res = await request(app)
        .get(`/admin/devices/${VALID_UUID}/locations`)
        .set('X-Admin-Key', ADMIN_KEY);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
      expect(mockPrisma.location.findMany).toHaveBeenCalledWith({
        where: { deviceId: VALID_UUID },
        orderBy: { timestamp: 'desc' },
        take: 500,
      });
    });

    it('deve rejeitar deviceId inválido', async () => {
      const res = await request(app)
        .get('/admin/devices/id-invalido/locations')
        .set('X-Admin-Key', ADMIN_KEY);

      expect(res.status).toBe(400);
    });
  });

  describe('GET /admin/users', () => {
    it('deve listar usuários cadastrados', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          name: 'Maria Silva',
          email: 'maria@example.com',
          phone: '11999999999',
          cpf: '12345678900',
          isActive: true,
          devices: [{ id: VALID_UUID, status: 'SECURE' }],
        },
      ]);

      const res = await request(app)
        .get('/admin/users')
        .set('X-Admin-Key', ADMIN_KEY);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].name).toBe('Maria Silva');
    });
  });

  describe('GET /admin/incidents', () => {
    it('deve listar os incidentes de pânico', async () => {
      mockPrisma.panicEvent.findMany.mockResolvedValue([
        {
          id: 10,
          triggerType: 'PIN_PANICO_IMEDIATO',
          timestamp: new Date(),
          resolved: false,
          device: { id: VALID_UUID, status: 'PANICO', user: { name: 'Maria' } },
        },
      ]);

      const res = await request(app)
        .get('/admin/incidents')
        .set('X-Admin-Key', ADMIN_KEY);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].triggerType).toBe('PIN_PANICO_IMEDIATO');
    });
  });

  describe('GET & PUT /admin/unlock-requests', () => {
    it('deve listar solicitações de desbloqueio com filtro', async () => {
      mockPrisma.unlockRequest.findMany.mockResolvedValue([
        {
          id: 'req-1',
          status: 'PENDING',
          user: { name: 'Maria', cpf: '123' },
        },
      ]);

      const res = await request(app)
        .get('/admin/unlock-requests?status=PENDING')
        .set('X-Admin-Key', ADMIN_KEY);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].id).toBe('req-1');
    });

    it('deve aprovar solicitação de desbloqueio e desativar o pânico do dispositivo', async () => {
      mockPrisma.unlockRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING',
        user: {
          id: 'user-1',
          devices: [{ id: VALID_UUID, fcmToken: null }],
        },
      });
      mockPrisma.unlockRequest.update.mockResolvedValue({
        id: 'req-1',
        status: 'APPROVED',
      });
      mockPrisma.device.update.mockResolvedValue({ id: VALID_UUID, status: 'SECURE' });
      mockPrisma.panicEvent.updateMany.mockResolvedValue({ count: 1 });

      const res = await request(app)
        .put('/admin/unlock-requests/req-1')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ action: 'APPROVED', adminNote: 'Selfie verificada' });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/aprovada com sucesso/i);
      expect(mockPrisma.device.update).toHaveBeenCalledWith({
        where: { id: VALID_UUID },
        data: { status: 'SECURE' },
      });
    });

    it('deve negar ação inválida', async () => {
      const res = await request(app)
        .put('/admin/unlock-requests/req-1')
        .set('X-Admin-Key', ADMIN_KEY)
        .send({ action: 'INVALID_ACTION' });

      expect(res.status).toBe(400);
    });
  });
});

