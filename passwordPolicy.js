export const PASSWORD_MIN_LENGTH = 8;

export function getPasswordChecks(password) {
  const value = String(password ?? "");
  return [
    { key: "length", label: `Не менее ${PASSWORD_MIN_LENGTH} символов`, passed: value.length >= PASSWORD_MIN_LENGTH },
    { key: "letter", label: "Хотя бы одна буква", passed: /[A-Za-zА-Яа-яЁё]/.test(value) },
    { key: "digit", label: "Хотя бы одна цифра", passed: /\d/.test(value) },
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
