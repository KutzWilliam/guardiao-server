import './mockPrisma';
import { mockPrisma } from './mockPrisma';
import request from 'supertest';
import app from '../src/app';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_change_me_in_prod';
const validToken = jwt.sign({ id: 'user-123', email: 'user@test.com' }, JWT_SECRET);

describe('Location Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /location/update', () => {
    it('deve salvar as coordenadas do dispositivo quando autenticado', async () => {
      mockPrisma.device.upsert.mockResolvedValue({ id: 'device-abc', userId: 'user-123' });
      mockPrisma.location.create.mockResolvedValue({
        id: 1,
        deviceId: 'device-abc',
        latitude: -23.55052,
        longitude: -46.633308,
      });

      const res = await request(app)
        .post('/location/update')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          deviceId: 'device-abc',
          latitude: -23.55052,
          longitude: -46.633308,
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/Coordenadas salvas/i);
      expect(mockPrisma.device.upsert).toHaveBeenCalled();
      expect(mockPrisma.location.create).toHaveBeenCalledWith({
        data: {
          deviceId: 'device-abc',
          latitude: -23.55052,
          longitude: -46.633308,
        },
      });
    });

    it('deve retornar 401 se não enviar token de autorização', async () => {
      const res = await request(app)
        .post('/location/update')
        .send({
          deviceId: 'device-abc',
          latitude: -23.55052,
          longitude: -46.633308,
        });

      expect(res.status).toBe(401);
      expect(mockPrisma.location.create).not.toHaveBeenCalled();
    });
  });

  describe('GET /location/:deviceId', () => {
    it('deve retornar lista de localizações de um dispositivo', async () => {
      mockPrisma.location.findMany.mockResolvedValue([
        { id: 1, deviceId: 'device-abc', latitude: -23.55, longitude: -46.63, timestamp: new Date() },
      ]);

      const res = await request(app)
        .get('/location/device-abc')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].deviceId).toBe('device-abc');
      expect(mockPrisma.location.findMany).toHaveBeenCalledWith({
        where: { deviceId: 'device-abc' },
        orderBy: { timestamp: 'desc' },
        take: 100,
      });
    });
  });
});
