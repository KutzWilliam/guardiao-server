import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middlewares/auth.middleware';

const router = Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_change_me_in_prod';

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().min(10),
  cpf: z.string().min(11),
  pinSeguro: z.string().min(4),
  pinTeatro: z.string().min(4),
  pinEmergencia: z.string().min(4).optional(),
  city: z.string().optional(),
  emergencyNote: z.string().optional(),
});

router.post('/register', async (req: Request, res: Response) => {
  try {
    const data = registerSchema.parse(req.body);

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email: data.email }, { cpf: data.cpf }],
      },
    });

    if (existingUser) {
      res.status(400).json({ error: 'Email ou CPF já cadastrado.' });
      return;
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const pinSeguroHash = await bcrypt.hash(data.pinSeguro, 10);
    const pinTeatroHash = await bcrypt.hash(data.pinTeatro, 10);
    const pinEmergenciaHash = data.pinEmergencia
      ? await bcrypt.hash(data.pinEmergencia, 10)
      : await bcrypt.hash('9999', 10);

    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash,
        phone: data.phone,
        cpf: data.cpf,
        pinSeguro: pinSeguroHash,
        pinTeatro: pinTeatroHash,
        pinEmergencia: pinEmergenciaHash,
        city: data.city,
        emergencyNote: data.emergencyNote,
      },
    });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

    res.status(201).json({
      message: 'Conta criada com sucesso',
      token,
      userId: user.id,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        cpf: user.cpf,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Erro interno ao registrar usuário.' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email e senha são obrigatórios.' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ error: 'Credenciais inválidas.' });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      res.status(401).json({ error: 'Credenciais inválidas.' });
      return;
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      message: 'Login realizado com sucesso',
      token,
      userId: user.id,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        cpf: user.cpf,
        city: user.city,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro interno ao realizar login.' });
  }
});

router.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user?.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        cpf: true,
        profilePhoto: true,
        city: true,
        emergencyNote: true,
      },
    });
    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

router.put('/pins', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { pinSeguro, pinTeatro, pinEmergencia } = req.body;
    if (!pinSeguro || !pinTeatro) {
      res.status(400).json({ error: 'pinSeguro e pinTeatro são obrigatórios.' });
      return;
    }

    const pinSeguroHash = await bcrypt.hash(String(pinSeguro), 10);
    const pinTeatroHash = await bcrypt.hash(String(pinTeatro), 10);
    const pinEmergenciaHash = pinEmergencia ? await bcrypt.hash(String(pinEmergencia), 10) : undefined;

    await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        pinSeguro: pinSeguroHash,
        pinTeatro: pinTeatroHash,
        ...(pinEmergenciaHash ? { pinEmergencia: pinEmergenciaHash } : {}),
      },
    });

    res.json({ message: 'PINs de segurança atualizados com sucesso.' });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno ao atualizar PINs.' });
  }
});

router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { cpf } = req.body;
    if (!cpf) {
      res.status(400).json({ error: 'CPF é obrigatório.' });
      return;
    }

    const cleanCpf = String(cpf).replace(/\D/g, '');
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ cpf: String(cpf) }, { cpf: cleanCpf }],
      },
    });
    if (!user) {
      res.status(404).json({ error: 'CPF não encontrado.' });
      return;
    }

    console.log(`[AUTH] Simulando envio de e-mail de recuperação para: ${user.email}`);

    res.json({ message: 'Se o CPF for válido, um e-mail de recuperação foi enviado.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

export default router;
