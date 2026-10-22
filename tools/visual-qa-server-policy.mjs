/** Keep the local QA server isolated from unrelated tasks using other ports. */
export function parseVisualQaPort(value) {
  if (value === undefined) return 3100;
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 5 ||
    /\D/.test(value)
  )
    throw new Error('VISUAL_QA_PORT must be an integer from 1 to 65535');
  const port = Number(value);
  if (port < 1 || port > 65535)
    throw new Error('VISUAL_QA_PORT must be an integer from 1 to 65535');
  return port;
}

export function allowsVisualQaOrigin(origin, port) {
  return (
    origin === undefined ||
    origin === `http://localhost:${port}` ||
    origin === `http://127.0.0.1:${port}`
  );
}
