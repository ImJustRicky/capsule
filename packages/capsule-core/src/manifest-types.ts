export type CapabilityName =
  | "storage.local"
  | "filesystem.import"
  | "filesystem.export"
  | "clipboard.write"
  | "network.fetch"
  | "dialog.open";

export interface PermissionRequest {
  capability: CapabilityName;
  scope: string | string[];
  reason: string;
  required?: boolean;
}

export interface CapsuleManifest {
  capsule_version: "1.0";
  name: string;
  slug: string;
  version: string;
  description: string;
  entry: string;
  author?: { name?: string; id?: string; url?: string };
  permissions: PermissionRequest[];
  network: { default: "deny"; allow: string[] };
  features?: { required?: string[]; optional?: string[] };
  integrity?: { content_hash: string; algorithm: "sha256" };
  display?: {
    icon?: string;
    accent_color?: string;
    preferred_size?: { width: number; height: number };
  };
  license?: { name?: string; url?: string };
  source?: { url?: string; path?: string };
  privacy?: { summary?: string; data_stored?: string[]; data_shared?: string[] };
}
