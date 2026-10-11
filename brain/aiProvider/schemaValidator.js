/**
 * Minimal JSON-schema validator for LLM output (no dependencies).
 * Supports: type, required, properties, items, enum.
 * Returns a list of human-readable problems; empty list means valid.
 */
function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

export function validateAgainstSchema(value, schema, path = '$') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;

  if (schema.type) {
    const actual = typeOf(value);
    const ok = schema.type === 'integer'
      ? actual === 'number' && Number.isInteger(value)
      : actual === schema.type;
    if (!ok) {
      errors.push(`${path}: expected ${schema.type}, got ${actual}`);
      return errors;
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: must be one of ${JSON.stringify(schema.enum)}`);
  }

  if (schema.type === 'object' || schema.properties) {
    for (const key of schema.required || []) {
      if (value[key] === undefined || value[key] === null) {
        errors.push(`${path}.${key}: required field missing`);
      }
    }
    for (const [key, def] of Object.entries(schema.properties || {})) {
      if (value[key] !== undefined && value[key] !== null) {
        errors.push(...validateAgainstSchema(value[key], def, `${path}.${key}`));
      }
    }
  }

  if (schema.type === 'array' && schema.items) {
    value.forEach((item, i) => errors.push(...validateAgainstSchema(item, schema.items, `${path}[${i}]`)));
  }

  return errors;
}
