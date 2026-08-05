import app from './app';
import { iniciarTimerAuditor } from './jobs/timerAuditor';

const PORT = process.env.PORT || 3000;

app.listen(PORT as number, '0.0.0.0', () => {
  console.log(`🚀 Servidor do Guardião rodando na porta ${PORT}`);

  // Inicia o CronJob de auditoria APÓS o servidor estar de pé.
  // Ele irá vigiar o banco a cada minuto em busca de timers expirados.
  iniciarTimerAuditor();
});

export default app;