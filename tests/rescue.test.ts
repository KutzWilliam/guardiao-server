import './mockPrisma';
import { mockPrisma } from './mockPrisma';
import request from 'supertest';
import app from '../src/app';

const VALID_UUID = '43af0407-93c8-48e9-b13b-fccb07e37384';

describe('Public Rescue Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /resgate/info/:deviceId', () => {
    it('deve retornar dados de resgate e última localização para contato de emergência', async () => {
      mockPrisma.device.findUnique.mockResolvedValue({
        id: VALID_UUID,
        status: 'PANICO',
      });
      mockPrisma.location.findFirst.mockResolvedValue({
        latitude: -23.55052,
        longitude: -46.633308,
        timestamp: new Date(),
      });

      const res = await request(app).get(`/resgate/info/${VALID_UUID}`);

      expect(res.status).toBe(200);
      expect(res.body.device.id).toBe(VALID_UUID);
      expect(res.body.lastLocation.latitude).toBe(-23.55052);
    });

    it('deve retornar 404 se o aparelho não existir', async () => {
      mockPrisma.device.findUnique.mockResolvedValue(null);

      const res = await request(app).get(`/resgate/info/${VALID_UUID}`);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /resgate/action', () => {
    it('deve desativar alerta quando contato clica "Está Seguro"', async () => {
      mockPrisma.device.update.mockResolvedValue({
        id: VALID_UUID,
        status: 'SECURE',
      });

      const res = await request(app)
        .post('/resgate/action')
        .send({
          deviceId: VALID_UUID,
          decisao: 'seguro',
        });

      expect(res.status).toBe(200);
      expect(mockPrisma.device.update).toHaveBeenCalledWith({
        where: { id: VALID_UUID },
        data: { status: 'SECURE' },
      });
    });

    it('deve confirmar pânico quando contato clica "Confirmar Pânico"', async () => {
      mockPrisma.device.update.mockResolvedValue({
        id: VALID_UUID,
        status: 'PANICO',
      });
      mockPrisma.panicEvent.create.mockResolvedValue({
        id: 1,
        deviceId: VALID_UUID,
        triggerType: 'CONTATO_CONFIRMOU_RESGATE',
      });
      mockPrisma.device.findUnique.mockResolvedValue({
        id: VALID_UUID,
        fcmToken: null,
      });

      const res = await request(app)
        .post('/resgate/action')
        .send({
          deviceId: VALID_UUID,
          decisao: 'panico',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/PÂNICO CONFIRMADO/i);
    });
  });
});
