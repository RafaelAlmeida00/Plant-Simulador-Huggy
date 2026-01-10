import { promises as fs } from 'fs';
import path from 'path';
import { logger } from './logger';

export async function resetTestDatabase() {
  // Define o caminho absoluto para a pasta. 
  // process.cwd() pega a raiz onde você roda o script.
  const folderPath = path.join(process.cwd(), 'src', 'adapters', 'database', 'test');
  const dbFilePath = path.join(folderPath, 'database.db');

  try {
    console.log(`Limpando diretório: ${folderPath}...`);

    // 1. Apaga a pasta inteira e tudo que tem dentro
    // 'force: true' evita erro se a pasta ainda não existir
    // 'recursive: true' permite apagar pastas com conteúdo
    await fs.rm(folderPath, { recursive: true, force: true });

    // 2. Recria a pasta 'test' vazia
    // 'recursive: true' garante que crie os pais se não existirem (ex: se 'database' não existir)
    await fs.mkdir(folderPath, { recursive: true });

    // 3. Cria o arquivo database.db vazio
    await fs.writeFile(dbFilePath, '');

    logger().info('Sucesso: Pasta limpa e database.db recriado.');

  } catch (error) {
    logger().error(`Erro ao resetar o banco de dados: ${error}`);
  }
}