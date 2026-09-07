export const PASSWORD_MIN_LENGTH = 8;

export function getPasswordChecks(password) {
  const value = String(password ?? "");
  return [
    { key: "length", label: `Не менее ${PASSWORD_MIN_LENGTH} символов`, passed: value.length >= PASSWORD_MIN_LENGTH },
  ];
}

export function validatePasswordPolicy(password) {
  const checks = getPasswordChecks(password);
  return {
    valid: checks.every((check) => check.passed),
    checks,
    missing: checks.filter((check) => !check.passed).map((check) => check.label.toLocaleLowerCase("ru-RU")),
  };
}
