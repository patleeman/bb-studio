import type { AiServiceRegistration } from "./ai-service-registry.js";

export function preferAiService(
  services: AiServiceRegistration[],
  preferServiceId: string | undefined,
): AiServiceRegistration[] {
  if (preferServiceId === undefined) return services;
  return [
    ...services.filter((service) => service.id === preferServiceId),
    ...services.filter((service) => service.id !== preferServiceId),
  ];
}

function isTextOnly(service: AiServiceRegistration): boolean {
  return service.complete !== null && service.transcribe === null;
}

export function forkAiServiceOrder(
  services: AiServiceRegistration[],
): AiServiceRegistration[] {
  return [
    ...services.filter((service) => !isTextOnly(service)),
    ...services.filter(isTextOnly),
  ];
}
