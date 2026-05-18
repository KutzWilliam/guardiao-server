import app from './app';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor do Guardião rodando na porta ${PORT}`);
});

export default app;