import './mockPrisma';
import { mockPrisma } from './mockPrisma';
import request from 'supertest';
import app from '../src/app';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_change_me_in_prod';
const validToken = jwt.sign({ id: 'user-123', email: 'user@test.com' }, JWT_SECRET);

describe('Sync Endpoints (SafeZones, Contacts, FCM)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /sync/safezone', () => {
    it('deve sincronizar uma SafeZone com sucesso', async () => {
      mockPrisma.device.upsert.mockResolvedValue({ id: 'device-123', userId: 'user-123' });
      mockPrisma.safeZone.upsert.mockResolvedValue({
        id: 'zone-1',
        name: 'Casa',
        latitude: -23.55,
        longitude: -46.63,
        radiusMeters: 100,
        deviceId: 'device-123',
      });

      const res = await request(app)
        .post('/sync/safezone')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          id: 'zone-1',
          deviceId: 'device-123',
          name: 'Casa',
          latitude: -23.55,
          longitude: -46.63,
          radiusMeters: 100,
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/SafeZone sincronizada/i);
      expect(mockPrisma.safeZone.upsert).toHaveBeenCalled();
    });

    it('deve retornar 400 se faltar campos obrigatórios na SafeZone', async () => {
      const res = await request(app)
        .post('/sync/safezone')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          id: 'zone-1',
          name: 'Casa',
        });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /sync/contact', () => {
    it('deve sincronizar um contato de emergência com sucesso', async () => {
      mockPrisma.device.upsert.mockResolvedValue({ id: 'device-123', userId: 'user-123' });
      mockPrisma.contact.upsert.mockResolvedValue({
        id: 'contact-1',
        name: 'Mãe',
        phone: '11999998888',
        deviceId: 'device-123',
      });

      const res = await request(app)
        .post('/sync/contact')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          id: 'contact-1',
          deviceId: 'device-123',
          name: 'Mãe',
          phone: '11999998888',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/Contato sincronizado/i);
    });

    it('deve retornar 400 se faltar o telefone do contato', async () => {
      const res = await request(app)
        .post('/sync/contact')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          id: 'contact-1',
          deviceId: 'device-123',
          name: 'Mãe',
        });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /sync/fcm', () => {
    it('deve sincronizar o token FCM do dispositivo', async () => {
      mockPrisma.device.upsert.mockResolvedValue({
        id: 'device-123',
        fcmToken: 'fcm-mock-token-xyz',
        userId: 'user-123',
      });

      const res = await request(app)
        .post('/sync/fcm')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          deviceId: 'device-123',
          fcmToken: 'fcm-mock-token-xyz',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/FCM Token sincronizado/i);
    });
  });
});
