import express, { Request, Response } from 'express';

const app = express();

app.use(express.json());

// Endpoint de Healthcheck para validação do CI/CD e monitoramento
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', timestamp: new Date() });
});

export default app;