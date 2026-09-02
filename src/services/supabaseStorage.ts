import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as path from 'path';

let supabaseClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  if (url && key) {
    supabaseClient = createClient(url, key);
    return supabaseClient;
  }
  return null;
}

/**
 * Realiza o upload da selfie do usuário para o bucket do Supabase Storage.
 * Retorna a URL pública do arquivo gerado.
 */
export async function uploadSelfie(userId: string, file: Express.Multer.File): Promise<string> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    console.warn('⚠️ Supabase Storage não configurado. Utilizando fallback para URL de selfie.');
    return `https://placeholder.com/selfies/${userId}-${Date.now()}.jpg`;
  }

  const bucketName = process.env.SUPABASE_BUCKET_SELFIES || 'guardiao-selfies';
  const fileExt = file.originalname ? path.extname(file.originalname) : '.jpg';
  const fileName = `${userId}/${Date.now()}${fileExt || '.jpg'}`;

  const { data, error } = await supabase.storage
    .from(bucketName)
    .upload(fileName, file.buffer, {
      contentType: file.mimetype || 'image/jpeg',
      upsert: true,
    });

  if (error) {
    console.error('❌ Erro no upload para o Supabase Storage:', error);
    // Em caso de falha de bucket ainda não criado ou permissão, retorna link ou propaga
    throw new Error(`Falha no upload para Supabase: ${error.message}`);
  }

  const { data: publicUrlData } = supabase.storage
    .from(bucketName)
    .getPublicUrl(data.path);

  return publicUrlData.publicUrl;
}
