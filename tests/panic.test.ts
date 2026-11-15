import './mockPrisma';
import { mockPrisma } from './mockPrisma';
import request from 'supertest';
import app from '../src/app';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_change_me_in_prod';
const validToken = jwt.sign({ id: 'user-123', email: 'user@test.com' }, JWT_SECRET);

describe('Panic Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /panic/trigger', () => {
    it('deve registrar evento de pânico imediato e atualizar status para PANICO', async () => {
      mockPrisma.device.upsert.mockResolvedValue({
        id: 'device-123',
        status: 'PANICO',
        userId: 'user-123',
      });
      mockPrisma.panicEvent.create.mockResolvedValue({
        id: 1,
        deviceId: 'device-123',
        triggerType: 'PIN_PANICO_IMEDIATO',
      });
      mockPrisma.device.findUnique.mockResolvedValue({
        id: 'device-123',
        fcmToken: null, // sem FCM para não tentar enviar no teste
      });

      const res = await request(app)
        .post('/panic/trigger')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          deviceId: 'device-123',
          triggerType: 'PIN_PANICO_IMEDIATO',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/Pânico registrado/i);
      expect(mockPrisma.device.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'PANICO' }),
        })
      );
      expect(mockPrisma.panicEvent.create).toHaveBeenCalled();
    });

    it('deve registrar evento de pânico por voz offline', async () => {
      mockPrisma.device.upsert.mockResolvedValue({
        id: 'device-123',
        status: 'PANICO',
        userId: 'user-123',
      });
      mockPrisma.panicEvent.create.mockResolvedValue({
        id: 2,
        deviceId: 'device-123',
        triggerType: 'GATILHO_VOZ_OFFLINE',
      });
      mockPrisma.device.findUnique.mockResolvedValue({ id: 'device-123', fcmToken: null });

      const res = await request(app)
        .post('/panic/trigger')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          deviceId: 'device-123',
          triggerType: 'GATILHO_VOZ_OFFLINE',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/Pânico registrado/i);
    });

    it('deve ativar o Modo Teatro (status ALERTA) e criar Timer silencioso de 15 minutos', async () => {
      mockPrisma.device.upsert.mockResolvedValue({
        id: 'device-123',
        status: 'ALERTA',
        userId: 'user-123',
      });
      mockPrisma.panicEvent.create.mockResolvedValue({
        id: 3,
        deviceId: 'device-123',
        triggerType: 'PIN_MODO_TEATRO',
      });
      mockPrisma.device.findUnique.mockResolvedValue({
        id: 'device-123',
        fcmToken: null,
        contacts: [{ id: 'c-1', name: 'Mãe', phone: '11999999999' }],
        user: { name: 'Maria' },
      });
      mockPrisma.timer.create.mockResolvedValue({
        id: 77,
        eventName: 'Alerta Silencioso (Modo Teatro / Coação)',
        deviceId: 'device-123',
      });

      const res = await request(app)
        .post('/panic/trigger')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          deviceId: 'device-123',
          triggerType: 'PIN_MODO_TEATRO',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ALERTA');
      expect(mockPrisma.timer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            device: { connect: { id: 'device-123' } },
            eventName: expect.stringMatching(/Modo Teatro/i),
          }),
        })
      );
    });
  });

  describe('POST /panic/unlock/biometrics', () => {
    it('deve desativar o pânico e restaurar status para SECURE via biometria', async () => {
      mockPrisma.device.findFirst.mockResolvedValue({
        id: 'device-123',
        userId: 'user-123',
      });
      mockPrisma.device.update.mockResolvedValue({
        id: 'device-123',
        status: 'SECURE',
      });
      mockPrisma.panicEvent.updateMany.mockResolvedValue({ count: 1 });

      const res = await request(app)
        .post('/panic/unlock/biometrics')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          deviceId: 'device-123',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/Pânico desativado via biometria/i);
      expect(mockPrisma.device.update).toHaveBeenCalledWith({
        where: { id: 'device-123' },
        data: { status: 'SECURE' },
      });
      expect(mockPrisma.panicEvent.updateMany).toHaveBeenCalledWith({
        where: { deviceId: 'device-123', resolved: false },
        data: { resolved: true },
      });
    });

    it('deve negar desbloqueio se o dispositivo não pertencer ao usuário autenticado', async () => {
      mockPrisma.device.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post('/panic/unlock/biometrics')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          deviceId: 'device-outro-usuario',
        });

      expect(res.status).toBe(403);
      expect(mockPrisma.device.update).not.toHaveBeenCalled();
    });
  });

  describe('POST /panic/unlock/request (Upload de Selfie)', () => {
    it('deve rejeitar se faltar campos obrigatórios ou a selfie', async () => {
      const res = await request(app)
        .post('/panic/unlock/request')
        .field('email', 'maria@example.com')
        .field('password', 'senha123');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/obrigatórios/i);
    });

    it('deve retornar 404 se usuário não for encontrado', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post('/panic/unlock/request')
        .field('email', 'inexistente@example.com')
        .field('password', 'senha123')
        .field('cpf', '12345678900')
        .attach('selfie', Buffer.from('fake image data'), 'selfie.jpg');

      expect(res.status).toBe(404);
    });

    it('deve criar solicitação de desbloqueio com sucesso e gerar selfieUrl', async () => {
      const bcrypt = require('bcryptjs');
      const hash = await bcrypt.hash('senha123', 8);

      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-123',
        name: 'Maria Silva',
        email: 'maria@example.com',
        cpf: '12345678900',
        passwordHash: hash,
      });

      mockPrisma.unlockRequest.create.mockResolvedValue({
        id: 'req-abc',
        userId: 'user-123',
        status: 'PENDING',
        selfieUrl: 'https://placeholder.com/selfies/user-123.jpg',
      });

      const res = await request(app)
        .post('/panic/unlock/request')
        .field('email', 'maria@example.com')
        .field('password', 'senha123')
        .field('cpf', '12345678900')
        .attach('selfie', Buffer.from('fake image data'), 'selfie.jpg');

      expect(res.status).toBe(201);
      expect(res.body.message).toMatch(/Solicitação criada com sucesso/i);
      expect(res.body.requestId).toBe('req-abc');
      expect(res.body.selfieUrl).toBeDefined();
    });
  });
});
