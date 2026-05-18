import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { updateSourceStatus } from "@/lib/app-service";
import { mapProviderStatusToHydraStatus } from "@/lib/ingest-workflow";

interface IndexingPayload {
  event: string;
  delivery_id: string;
  id: string;
  tenant_id: string;
  sub_tenant_id: string;
  status: string;
  error_code?: string;
  error_message?: string;
  timestamp: string;
}

const seenDeliveries = new Set<string>();
const SEEN_LIMIT = 512;

export async function POST(req: Request) {
  if (process.env.HYDRA_WEBHOOK_ENABLED !== "1") {
    return new Response("webhook disabled", { status: 503 });
  }
  const signingSecret = process.env.HYDRA_WEBHOOK_SECRET;
  if (!signingSecret) {
    return new Response("server misconfigured", { status: 500 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-hydradb-signature");
  if (!signature || !verifySignature(rawBody, signature, signingSecret)) {
    return new Response("invalid signature", { status: 401 });
  }

  const deliveryId = req.headers.get("x-hydradb-delivery-id");
  if (deliveryId && seenDeliveries.has(deliveryId)) {
    return new Response("duplicate", { status: 200 });
  }
  if (deliveryId) {
    seenDeliveries.add(deliveryId);
    if (seenDeliveries.size > SEEN_LIMIT) {
      const first = seenDeliveries.values().next().value;
      if (first) seenDeliveries.delete(first);
    }
  }

  let payload: IndexingPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  if (payload.event !== "indexing.status_changed") {
    return new Response("unsupported event", { status: 202 });
  }

  const mapped = mapProviderStatusToHydraStatus(payload.status);
  try {
    await updateSourceStatus(payload.id, mapped);
    revalidatePath("/ingest");
  } catch (error) {
    console.error("[webhook] failed to update source status", payload.id, error);
    return new Response("update failed", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}

function verifySignature(rawBody: string, signature: string, secret: string) {
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  try {
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}
