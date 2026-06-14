import { beforeEach, describe, expect, test } from 'vitest';

import { ipcora } from '../..';
import { createMemoryTestAdapter, createPeer, type MemoryTestAdapter } from './helpers';

let ipcAdapter: MemoryTestAdapter = createMemoryTestAdapter();

beforeEach(() => {
  ipcAdapter = createMemoryTestAdapter();
});

describe('use plugin', () => {
  test('unnamed plugin can be used multiple times and later use wins', async () => {
    // Non-singleton: no name → no double-use guard at the plugin level.
    // Each use() merges routes; duplicate paths are replaced by the later use.
    const plugin = ipcora()
      .handler('greet', () => 'hello')
      .handler('farewell', () => 'bye');

    const app = ipcora({
      channel: 'test:plugin-multi',
      adapter: ipcAdapter.adapter,
    });

    // First use — succeeds, routes are merged.
    app.use(plugin);
    expect(app.manifest).toMatchObject({
      greet: expect.any(Function),
      farewell: expect.any(Function),
    });

    expect(() => app.use(plugin)).not.toThrow();

    app.bind(createPeer(1));
    await expect(
      ipcAdapter.invoke('test:plugin-multi', 1, { id: '1', path: 'greet' }),
    ).resolves.toEqual({
      data: 'hello',
    });
  });

  test('multiple different unnamed plugins merge without conflicts', async () => {
    const authPlugin = ipcora()
      .handler('auth.login', () => 'token')
      .macro('auth', {
        onGuard({ option, fail }) {
          if (!option) throw fail('UNAUTHORIZED');
        },
      });

    const auditPlugin = ipcora()
      .handler('audit.log', () => 'logged')
      .derive(() => ({ auditId: 'audit-1' }));

    const app = ipcora({
      channel: 'test:plugin-multi-diff',
      adapter: ipcAdapter.adapter,
    });

    // Both plugins have different routes — no conflicts.
    expect(() => {
      app.use(authPlugin).use(auditPlugin);
    }).not.toThrow();

    expect(app.manifest).toMatchObject({
      auth: { login: expect.any(Function) },
      audit: { log: expect.any(Function) },
    });
  });

  test('named plugin is deduped per parent but can be reused across parents', () => {
    const plugin = ipcora({ name: 'auth-plugin' }).handler('login', () => 'ok');

    const app1 = ipcora({
      channel: 'test:plugin-named-1',
      adapter: ipcAdapter.adapter,
    });
    app1.use(plugin);

    const app2 = ipcora({
      channel: 'test:plugin-named-2',
      adapter: ipcAdapter.adapter,
    });
    expect(() => app2.use(plugin)).not.toThrow();
    expect(() => app1.use(plugin)).not.toThrow();
  });

  test('plugin route overrides an existing parent route', async () => {
    const plugin = ipcora().handler('ping', () => 'from-plugin');

    const app = ipcora({
      channel: 'test:plugin-conflict',
      adapter: ipcAdapter.adapter,
    }).handler('ping', () => 'from-app');

    app.use(plugin).bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:plugin-conflict', 1, { id: '1', path: 'ping' }),
    ).resolves.toEqual({
      data: 'from-plugin',
    });
  });

  test('plugin route overrides group-prefixed parent route', async () => {
    const plugin = ipcora().group('api', g => g.handler('status', () => 'ok'));

    const app = ipcora({
      channel: 'test:plugin-group-conflict',
      adapter: ipcAdapter.adapter,
    }).handler('api.status', () => 'from-app');

    app.use(plugin).bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:plugin-group-conflict', 1, { id: '1', path: 'api.status' }),
    ).resolves.toEqual({
      data: 'ok',
    });
  });

  test('merging plugin routes — all are callable after successful merge', async () => {
    const plugin = ipcora()
      .handler('math.add', ({ params }) => {
        const p = params as unknown as { a: number; b: number };
        return p.a + p.b;
      })
      .handler('math.sub', ({ params }) => {
        const p = params as unknown as { a: number; b: number };
        return p.a - p.b;
      });

    const app = ipcora({
      channel: 'test:plugin-merge-callable',
      adapter: ipcAdapter.adapter,
    })
      .handler('health', () => 'ok')
      .use(plugin);

    app.bind(createPeer(1));

    // Parent route works.
    await expect(
      ipcAdapter.invoke('test:plugin-merge-callable', 1, { id: '1', path: 'health' }),
    ).resolves.toEqual({ data: 'ok' });

    // Plugin routes work.
    await expect(
      ipcAdapter.invoke('test:plugin-merge-callable', 1, {
        id: '2',
        path: 'math.add',
        params: { a: 3, b: 4 },
      }),
    ).resolves.toEqual({ data: 7 });

    await expect(
      ipcAdapter.invoke('test:plugin-merge-callable', 1, {
        id: '3',
        path: 'math.sub',
        params: { a: 10, b: 3 },
      }),
    ).resolves.toEqual({ data: 7 });
  });

  test('plugin hooks run after parent hooks (global-level merge order)', async () => {
    const calls: string[] = [];

    const plugin = ipcora()
      .onBeforeHandle(() => {
        calls.push('plugin:onBeforeHandle');
      })
      .handler('run', () => 'ok');

    const app = ipcora({
      channel: 'test:plugin-hook-order',
      adapter: ipcAdapter.adapter,
    })
      .onBeforeHandle(() => {
        calls.push('app:onBeforeHandle');
      })
      .use(plugin);

    app.bind(createPeer(1));

    await ipcAdapter.invoke('test:plugin-hook-order', 1, { id: '1', path: 'run' });

    // App hooks registered first, plugin hooks pushed after → run in order.
    expect(calls).toEqual(['app:onBeforeHandle', 'plugin:onBeforeHandle']);
  });

  test('plugin derive runs after parent derive for plugin routes', async () => {
    const calls: string[] = [];

    const plugin = ipcora()
      .derive(() => {
        calls.push('plugin:derive');
        return { p: 'plugin' };
      })
      .handler('run', ctx => {
        calls.push(`handler:p=${(ctx as any).p}`);
        return 'ok';
      });

    const app = ipcora({
      channel: 'test:plugin-mw-order',
      adapter: ipcAdapter.adapter,
    })
      .derive(() => {
        calls.push('app:derive');
        return { a: 'app' };
      })
      .use(plugin);

    app.bind(createPeer(1));

    await ipcAdapter.invoke('test:plugin-mw-order', 1, { id: '1', path: 'run' });

    expect(calls).toEqual(['app:derive', 'plugin:derive', 'handler:p=plugin']);
  });

  test('local plugin lifecycle does not affect parent routes registered after use', async () => {
    const calls: string[] = [];
    const plugin = ipcora()
      .onBeforeHandle(() => {
        calls.push('plugin');
      })
      .handler('plugin', () => 'plugin');

    const app = ipcora({
      channel: 'test:plugin-local-scope',
      adapter: ipcAdapter.adapter,
    })
      .use(plugin)
      .handler('parent', () => 'parent');

    app.bind(createPeer(1));

    await ipcAdapter.invoke('test:plugin-local-scope', 1, { id: '1', path: 'parent' });
    expect(calls).toEqual([]);

    await ipcAdapter.invoke('test:plugin-local-scope', 1, { id: '2', path: 'plugin' });
    expect(calls).toEqual(['plugin']);
  });

  test('scoped plugin lifecycle affects parent routes registered after use only', async () => {
    const calls: string[] = [];
    const plugin = ipcora()
      .onBeforeHandle(({ path }) => {
        calls.push(`plugin:${path}`);
      })
      .handler('plugin', () => 'plugin')
      .as('scoped');

    const app = ipcora({
      channel: 'test:plugin-scoped-scope',
      adapter: ipcAdapter.adapter,
    })
      .handler('before', () => 'before')
      .use(plugin)
      .handler('after', () => 'after');

    app.bind(createPeer(1));

    await ipcAdapter.invoke('test:plugin-scoped-scope', 1, { id: '1', path: 'before' });
    await ipcAdapter.invoke('test:plugin-scoped-scope', 1, { id: '2', path: 'after' });
    await ipcAdapter.invoke('test:plugin-scoped-scope', 1, { id: '3', path: 'plugin' });

    expect(calls).toEqual(['plugin:after', 'plugin:plugin']);
  });

  test('later parent route overrides plugin route', async () => {
    const plugin = ipcora().handler('ping', () => 'from-plugin');
    const app = ipcora({
      channel: 'test:plugin-parent-later-override',
      adapter: ipcAdapter.adapter,
    })
      .use(plugin)
      .handler('ping', () => 'from-parent');

    app.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:plugin-parent-later-override', 1, { id: '1', path: 'ping' }),
    ).resolves.toEqual({ data: 'from-parent' });
  });

  test('later plugin overrides earlier plugin route', async () => {
    const pluginA = ipcora().handler('ping', () => 'from-a');
    const pluginB = ipcora().handler('ping', () => 'from-b');
    const app = ipcora({
      channel: 'test:plugin-plugin-later-override',
      adapter: ipcAdapter.adapter,
    })
      .use(pluginA)
      .use(pluginB);

    app.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:plugin-plugin-later-override', 1, { id: '1', path: 'ping' }),
    ).resolves.toEqual({ data: 'from-b' });
  });

  test('plugin state and decorators merge with parent (later plugin wins on conflict)', async () => {
    const plugin = ipcora()
      .state('version', 1)
      .state('pluginOnly', true)
      .decorate('env', 'plugin-env')
      .decorate('source', 'plugin');

    // Cast to access private store/decorators for assertions.
    const app = ipcora({
      channel: 'test:plugin-state',
      adapter: ipcAdapter.adapter,
    })
      .state('version', 2)
      .decorate('env', 'app-env')
      .use(plugin)
      .handler('read', ({ store, env, source }) => ({
        version: store.version,
        env,
        source,
        pluginOnly: store.pluginOnly,
      }));

    app.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:plugin-state', 1, { id: '1', path: 'read' }),
    ).resolves.toEqual({
      data: {
        version: 1,
        env: 'plugin-env',
        source: 'plugin',
        pluginOnly: true,
      },
    });
  });

  test('plugin error mappers are merged and functional', async () => {
    class PluginError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'PluginError';
      }
    }

    const plugin = ipcora().error(PluginError, ({ fail, error }) =>
      fail('PLUGIN_ERR', { message: error.message }),
    );

    const app = ipcora({
      channel: 'test:plugin-err-merge',
      adapter: ipcAdapter.adapter,
    })
      .use(plugin)
      .handler('fail', () => {
        throw new PluginError('from plugin');
      });

    app.bind(createPeer(1));

    await expect(
      ipcAdapter.invoke('test:plugin-err-merge', 1, { id: '1', path: 'fail' }),
    ).resolves.toMatchObject({
      error: { name: 'PLUGIN_ERR', message: 'from plugin' },
    });
  });

  test('plugin macros are merged and usable by parent routes', async () => {
    const calls: string[] = [];

    const plugin = ipcora().macro('timed', {
      onBeforeHandle({ path }) {
        calls.push(`timed:enter:${path}`);
      },
      onAfterHandle({ path, response }) {
        calls.push(`timed:exit:${path}`);
        return response;
      },
    });

    const app = ipcora({
      channel: 'test:plugin-macro-merge',
      adapter: ipcAdapter.adapter,
    })
      .use(plugin)
      .handler('run', () => 'ok', { timed: true });

    app.bind(createPeer(1));

    await ipcAdapter.invoke('test:plugin-macro-merge', 1, { id: '1', path: 'run' });

    expect(calls).toEqual(['timed:enter:run', 'timed:exit:run']);
  });

  test('unnamed plugin can be reused across different parent routers independently', () => {
    const plugin = ipcora()
      .handler('shared', () => 'shared-result')
      .derive(() => ({ trace: 'plugin' }));

    // No name = non-singleton. Each parent gets its own copy.
    const app1 = ipcora({
      channel: 'test:plugin-reuse-1',
      adapter: ipcAdapter.adapter,
    }).use(plugin);

    // Second use in a DIFFERENT parent — this should work because the
    // singleton guard only applies to NAMED plugins. Unnamed plugins
    // are standalone on each use().
    const app2 = ipcora({
      channel: 'test:plugin-reuse-2',
      adapter: ipcAdapter.adapter,
    }).use(plugin);

    expect(app1.manifest).toMatchObject({ shared: expect.any(Function) });
    expect(app2.manifest).toMatchObject({ shared: expect.any(Function) });

    expect(() => app1.use(plugin)).not.toThrow();
  });

  test('non-abstract plugin without adapter merges routes into parent with adapter', async () => {
    // Plugin has no adapter — it's just a "blueprint" of routes/hooks.
    // The parent provides the adapter and channel. Plugin's bind() is never called.
    const plugin = ipcora()
      .handler('typeOnly', () => 'typed')
      .derive(() => ({ fromPlugin: 'yes' }));

    const app = ipcora({
      channel: 'test:plugin-no-adapter',
      adapter: ipcAdapter.adapter,
    }).use(plugin);

    app.bind(createPeer(1));

    // Route definition is present.
    expect(app.manifest).toMatchObject({
      typeOnly: expect.any(Function),
    });

    // Route is actually callable through the parent's adapter.
    await expect(
      ipcAdapter.invoke('test:plugin-no-adapter', 1, { id: '1', path: 'typeOnly' }),
    ).resolves.toEqual({ data: 'typed' });

    // Adapter is installed exactly once (by the parent, not the plugin).
    expect(ipcAdapter.adapter.handle).toHaveBeenCalledTimes(1);
  });
});
