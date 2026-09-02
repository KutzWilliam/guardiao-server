import './mockPrisma';
import { mockPrisma } from './mockPrisma';
import request from 'supertest';
import app from '../src/app';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_change_me_in_prod';
const validToken = jwt.sign({ id: 'user-123', email: 'user@test.com' }, JWT_SECRET);

describe('Smart Timer Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /timer/start', () => {
    it('deve criar um timer persistente com data futura', async () => {
      const dataFutura = new Date(Date.now() + 3600000).toISOString();
      mockPrisma.device.upsert.mockResolvedValue({ id: 'device-123', userId: 'user-123' });
      mockPrisma.timer.create.mockResolvedValue({
        id: 1,
        eventName: 'Volta da Faculdade',
        targetTimestamp: new Date(dataFutura),
        deviceId: 'device-123',
        isActive: true,
      });

      const res = await request(app)
        .post('/timer/start')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          deviceId: 'device-123',
          eventName: 'Volta da Faculdade',
          targetTimestamp: dataFutura,
        });

      expect(res.status).toBe(201);
      expect(res.body.message).toMatch(/Timer criado com sucesso/i);
      expect(mockPrisma.timer.create).toHaveBeenCalled();
    });

    it('deve rejeitar timer com data no passado', async () => {
      const dataPassada = new Date(Date.now() - 3600000).toISOString();

      const res = await request(app)
        .post('/timer/start')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          deviceId: 'device-123',
          eventName: 'Volta da Faculdade',
          targetTimestamp: dataPassada,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/data futura/i);
      expect(mockPrisma.timer.create).not.toHaveBeenCalled();
    });

    it('deve rejeitar timer sem campos obrigatórios', async () => {
      const res = await request(app)
        .post('/timer/start')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          deviceId: 'device-123',
        });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /timer/checkin', () => {
    it('deve desarmar o timer ativo com sucesso', async () => {
      mockPrisma.timer.findFirst.mockResolvedValue({
        id: 1,
        deviceId: 'device-123',
        eventName: 'Volta da Faculdade',
        isActive: true,
        checkedIn: false,
      });
      mockPrisma.timer.update.mockResolvedValue({
        id: 1,
        eventName: 'Volta da Faculdade',
        isActive: false,
        checkedIn: true,
      });

      const res = await request(app)
        .post('/timer/checkin')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          deviceId: 'device-123',
          timerId: 1,
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/Check-in realizado com sucesso/i);
      expect(mockPrisma.timer.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { checkedIn: true, isActive: false },
      });
    });

    it('deve retornar 403 se o timer não pertencer ao dispositivo', async () => {
      mockPrisma.timer.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post('/timer/checkin')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          deviceId: 'device-errado',
          timerId: 999,
        });

      expect(res.status).toBe(403);
    });

    it('deve retornar 409 se o timer já estiver inativo/encerrado', async () => {
      mockPrisma.timer.findFirst.mockResolvedValue({
        id: 1,
        deviceId: 'device-123',
        eventName: 'Volta da Faculdade',
        isActive: false, // já inativo
      });

      const res = await request(app)
        .post('/timer/checkin')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          deviceId: 'device-123',
          timerId: 1,
        });

      expect(res.status).toBe(409);
    });
  });

  describe('GET /timer/list', () => {
    it('deve listar timers ativos filtrando por deviceId', async () => {
      mockPrisma.timer.findMany.mockResolvedValue([
        {
          id: 1,
          eventName: 'Caminhada noturna',
          isActive: true,
          targetTimestamp: new Date(),
          contacts: [],
          safeZone: null,
        },
      ]);

      const res = await request(app)
        .get('/timer/list?deviceId=device-123')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].eventName).toBe('Caminhada noturna');
      expect(mockPrisma.timer.findMany).toHaveBeenCalledWith({
        where: { isActive: true, deviceId: 'device-123' },
        include: {
          safeZone: true,
          contacts: { select: { id: true, name: true, phone: true } },
        },
        orderBy: { targetTimestamp: 'asc' },
      });
    });
  });
});
