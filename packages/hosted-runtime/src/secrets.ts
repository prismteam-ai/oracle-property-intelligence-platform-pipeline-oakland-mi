import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { AccessService, type AccessConfig } from "./access.ts";
export function secretAccessProvider(
  secretId: string,
  client = new SecretsManagerClient({}),
  clock = Date.now,
) {
  let cached: { until: number; service: AccessService } | undefined;
  let loading: Promise<AccessService> | undefined;
  return async () => {
    if (cached && cached.until > clock()) return cached.service;
    if (loading) return loading;
    loading = (async () => {
      const out = await client.send(
        new GetSecretValueCommand({ SecretId: secretId }),
      );
      const config = JSON.parse(out.SecretString ?? "null") as AccessConfig;
      const service = new AccessService(config, clock);
      cached = { service, until: clock() + 60000 };
      return service;
    })();
    try {
      return await loading;
    } finally {
      loading = undefined;
    }
  };
}
