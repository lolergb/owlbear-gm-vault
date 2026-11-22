// Closed vocabulary shared by the import flow and analytics. Never derive codes
// from exception messages, URLs, file names, response bodies or validation text.
export const IMPORT_ERROR_CODES = Object.freeze({
  input: ['invalid_url', 'missing_url'],
  read: ['file_read_failed', 'response_read_failed'],
  fetch: ['fetch_failed'],
  http: ['http_error'],
  parse: ['invalid_json', 'html_response', 'empty_file'],
  validate: ['invalid_config', 'missing_categories', 'empty_vault', 'invalid_option'],
  prepare: ['prepare_failed'],
  apply: ['apply_failed'],
  save: ['storage_failed'],
  display: ['display_failed'],
  // Existing Notion import phases.
  generate: ['generate'],
  empty: ['empty']
});

export function normalizeImportDiagnostic(stage, code, source) {
  const safeStage = typeof stage === 'string' && Object.hasOwn(IMPORT_ERROR_CODES, stage) ? stage : 'unknown';
  const codes = IMPORT_ERROR_CODES[safeStage] || [];
  const defaultCode = safeStage === 'read' && source === 'url' ? 'response_read_failed' : codes[0];
  return { stage: safeStage, code: codes.includes(code) ? code : (defaultCode || 'unknown') };
}
