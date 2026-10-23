export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const input = req[source];
    const result = schema.safeParse(
      input && typeof input === 'object' && !Array.isArray(input) ? input : {},
    );
    if (!result.success) {
      const errors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (field !== undefined && !Object.hasOwn(errors, field)) {
          errors[field] = issue.message;
        }
      }
      return res.status(400).json({ message: 'Validation failed.', errors });
    }
    req[source] = result.data;
    return next();
  };
}
