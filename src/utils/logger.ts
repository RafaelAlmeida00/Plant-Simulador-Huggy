import { Logger, pino } from "pino";

// Configuração do logger usando pino e exportação do arquivo logger.log
export function logger(): Logger<never, boolean> {
    const logger = pino({ level: 'trace' });  // Mostra todos os níveis, incluindo trace e debug
    return logger;
}
