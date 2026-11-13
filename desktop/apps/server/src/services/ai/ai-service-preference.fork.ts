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
