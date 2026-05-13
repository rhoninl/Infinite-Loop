import path from 'node:path';
import { loadPlugins } from './loader';
import type { WebhookPlugin } from '../../shared/trigger';

function pluginsDir(): string {
  return (
    process.env.INFLOOP_WEBHOOK_PLUGINS_DIR ||
    path.join(process.cwd(), 'webhook-plugins')
  );
}

class PluginIndex {
  private cache: WebhookPlugin[] | null = null;
  private building: Promise<WebhookPlugin[]> | null = null;

  async list(): Promise<WebhookPlugin[]> {
    return this.ensure();
  }

  async lookup(id: string): Promise<WebhookPlugin | undefined> {
    const all = await this.ensure();
    return all.find((p) => p.id === id);
  }

  invalidate(): void {
    this.cache = null;
    this.building = null;
  }

  private async ensure(): Promise<WebhookPlugin[]> {
    if (this.cache) return this.cache;
    if (this.building) return this.building;
    this.building = (async () => {
      const plugins = await loadPlugins(pluginsDir());
      this.cache = plugins;
      this.building = null;
      return plugins;
    })();
    return this.building;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __infloopPluginIndex: PluginIndex | undefined;
}

export const pluginIndex: PluginIndex =
  globalThis.__infloopPluginIndex ?? new PluginIndex();
if (!globalThis.__infloopPluginIndex) {
  globalThis.__infloopPluginIndex = pluginIndex;
}
