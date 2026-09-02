import './mockPrisma';
import { mockPrisma } from './mockPrisma';
import request from 'supertest';
import app from '../src/app';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

describe('Auth Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /auth/register', () => {
    it('deve registrar um usuário com sucesso e retornar token', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-uuid-1',
        name: 'Maria Silva',
        email: 'maria@example.com',
        phone: '11999998888',
        cpf: '12345678901',
      });

      const res = await request(app)
        .post('/auth/register')
        .send({
          name: 'Maria Silva',
          email: 'maria@example.com',
          password: 'password123',
          phone: '11999998888',
          cpf: '12345678901',
          pinSeguro: '1234',
          pinTeatro: '5555',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('token');
      expect(res.body.userId).toBe('user-uuid-1');
      expect(mockPrisma.user.create).toHaveBeenCalled();
    });

    it('deve rejeitar registro se email ou CPF já existirem', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'existing-user' });

      const res = await request(app)
        .post('/auth/register')
        .send({
          name: 'Maria Silva',
          email: 'maria@example.com',
          password: 'password123',
          phone: '11999998888',
          cpf: '12345678901',
          pinSeguro: '1234',
          pinTeatro: '5555',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/já cadastrado/i);
    });

    it('deve rejeitar registro com dados inválidos (validação Zod)', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({
          name: 'M',
          email: 'invalid-email',
          password: '123',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /auth/login', () => {
    it('deve realizar login com credenciais corretas', async () => {
      const passwordHash = await bcrypt.hash('password123', 10);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'maria@example.com',
        passwordHash,
      });

      const res = await request(app)
        .post('/auth/login')
        .send({
          email: 'maria@example.com',
          password: 'password123',
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.userId).toBe('user-uuid-1');
    });

    it('deve rejeitar login com senha incorreta', async () => {
      const passwordHash = await bcrypt.hash('correct_password', 10);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'maria@example.com',
        passwordHash,
      });

      const res = await request(app)
        .post('/auth/login')
        .send({
          email: 'maria@example.com',
          password: 'wrong_password',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Credenciais inválidas/i);
    });

    it('deve rejeitar login se email não existir', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/auth/login')
        .send({
          email: 'naoexiste@example.com',
          password: 'password123',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Credenciais inválidas/i);
    });
  });

  describe('GET /auth/me', () => {
    it('deve retornar dados do perfil do usuário autenticado', async () => {
      const token = jwt.sign(
        { id: 'user-uuid-1', email: 'maria@example.com' },
        process.env.JWT_SECRET || 'super_secret_key_change_me_in_prod'
      );

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-uuid-1',
        name: 'Maria Silva',
        email: 'maria@example.com',
        phone: '11999998888',
        cpf: '12345678901',
        profilePhoto: null,
        city: 'São Paulo',
      });

      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Maria Silva');
      expect(res.body.email).toBe('maria@example.com');
    });

    it('deve rejeitar requisição sem token de autorização', async () => {
      const res = await request(app).get('/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/forgot-password', () => {
    it('deve simular envio de email para CPF cadastrado', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'maria@example.com',
        cpf: '12345678901',
      });

      const res = await request(app)
        .post('/auth/forgot-password')
        .send({ cpf: '12345678901' });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/recuperação/i);
    });

    it('deve retornar 404 se CPF não for encontrado', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post('/auth/forgot-password')
        .send({ cpf: '00000000000' });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/não encontrado/i);
    });
  });
});
