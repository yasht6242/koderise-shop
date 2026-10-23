/**
 * Minimal in-memory stand-in for the Prisma models used by Back-in-Stock tests.
 * Does not touch prisma/dev.sqlite or any real database file.
 */

function matchesWhere(row, where = {}) {
  for (const [key, expected] of Object.entries(where)) {
    if (expected instanceof Date) {
      if (
        !(row[key] instanceof Date) ||
        row[key].getTime() !== expected.getTime()
      ) {
        return false;
      }
      continue;
    }

    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if ("in" in expected) {
        if (!expected.in.includes(row[key])) return false;
        continue;
      }
      if ("lt" in expected) {
        if (!(row[key] < expected.lt)) return false;
        continue;
      }
      continue;
    }

    if (row[key] !== expected) return false;
  }
  return true;
}

function applyData(row, data) {
  const next = { ...row };
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && "increment" in value) {
      next[key] = (next[key] ?? 0) + value.increment;
    } else if (value && typeof value === "object" && "decrement" in value) {
      next[key] = (next[key] ?? 0) - value.decrement;
    } else {
      next[key] = value;
    }
  }
  next.updatedAt = new Date();
  return next;
}

let idCounter = 1;
function nextId(prefix) {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

export function createMockDb(seed = {}) {
  const state = {
    subscriptions: [...(seed.subscriptions || [])],
    notifications: [...(seed.notifications || [])],
    inventoryStates: [...(seed.inventoryStates || [])],
    processedWebhooks: [...(seed.processedWebhooks || [])],
    shopSettings: [...(seed.shopSettings || [])],
    shopSettingReadError: seed.shopSettingReadError || null,
  };

  const dbClient = {
    backInStockSubscription: {
      async findFirst({ where }) {
        return (
          state.subscriptions.find((row) => matchesWhere(row, where)) || null
        );
      },
      async findMany({ where, select } = {}) {
        let rows = state.subscriptions.filter((row) =>
          matchesWhere(row, where || {}),
        );
        if (select) {
          rows = rows.map((row) => {
            const picked = {};
            for (const key of Object.keys(select)) {
              if (select[key]) picked[key] = row[key];
            }
            return picked;
          });
        }
        return rows;
      },
      async create({ data }) {
        const row = {
          id: data.id || nextId("sub"),
          notifiedAt: null,
          createdAt: new Date(),
          ...data,
        };
        state.subscriptions.push(row);
        return row;
      },
      async updateMany({ where, data }) {
        let count = 0;
        state.subscriptions = state.subscriptions.map((row) => {
          if (!matchesWhere(row, where)) return row;
          count += 1;
          return { ...row, ...data };
        });
        return { count };
      },
    },

    backInStockNotification: {
      async findMany({ where, orderBy, take } = {}) {
        let rows = state.notifications.filter((row) => {
          if (!where) return true;
          for (const [key, expected] of Object.entries(where)) {
            if (key === "OR") {
              const ok = expected.some((clause) => matchesWhere(row, clause));
              if (!ok) return false;
              continue;
            }
            if (expected && typeof expected === "object" && "in" in expected) {
              if (!expected.in.includes(row[key])) return false;
              continue;
            }
            if (expected && typeof expected === "object" && "lt" in expected) {
              if (!(row[key] < expected.lt)) return false;
              continue;
            }
            if (row[key] !== expected) return false;
          }
          return true;
        });

        if (orderBy?.createdAt === "asc") {
          rows = [...rows].sort(
            (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
          );
        }
        if (orderBy?.updatedAt === "asc") {
          rows = [...rows].sort(
            (a, b) => a.updatedAt.getTime() - b.updatedAt.getTime(),
          );
        }
        if (typeof take === "number") rows = rows.slice(0, take);
        return rows;
      },
      async create({ data }) {
        const duplicate = state.notifications.find(
          (row) =>
            row.subscriptionId === data.subscriptionId &&
            row.restockKey === data.restockKey,
        );
        if (duplicate) {
          const error = new Error("Unique constraint failed");
          error.code = "P2002";
          throw error;
        }

        const row = {
          id: data.id || nextId("note"),
          status: data.status || "PENDING",
          attempts: data.attempts ?? 0,
          lastError: data.lastError ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
          sentAt: null,
          ...data,
        };
        state.notifications.push(row);
        return row;
      },
      async update({ where, data }) {
        const index = state.notifications.findIndex(
          (row) => row.id === where.id,
        );
        if (index < 0) throw new Error("Notification not found");
        state.notifications[index] = applyData(
          state.notifications[index],
          data,
        );
        return state.notifications[index];
      },
      async updateMany({ where, data }) {
        let count = 0;
        state.notifications = state.notifications.map((row) => {
          if (!matchesWhere(row, where)) return row;
          // Exact Date match for optimistic concurrency when provided.
          if (
            where.updatedAt instanceof Date &&
            row.updatedAt.getTime() !== where.updatedAt.getTime()
          ) {
            return row;
          }
          if (
            where.attempts &&
            typeof where.attempts === "object" &&
            "lt" in where.attempts &&
            !(row.attempts < where.attempts.lt)
          ) {
            return row;
          }
          count += 1;
          return applyData(row, data);
        });
        return { count };
      },
    },

    inventoryVariantState: {
      async findUnique({ where }) {
        if (where.shop_variantId) {
          return (
            state.inventoryStates.find(
              (row) =>
                row.shop === where.shop_variantId.shop &&
                row.variantId === where.shop_variantId.variantId,
            ) || null
          );
        }
        return state.inventoryStates.find((row) => row.id === where.id) || null;
      },
      async create({ data }) {
        const row = {
          id: data.id || nextId("inv"),
          updatedAt: new Date(),
          ...data,
        };
        state.inventoryStates.push(row);
        return row;
      },
      async update({ where, data }) {
        const index = state.inventoryStates.findIndex(
          (row) => row.id === where.id,
        );
        if (index < 0) throw new Error("Inventory state not found");
        state.inventoryStates[index] = {
          ...state.inventoryStates[index],
          ...data,
          updatedAt: new Date(),
        };
        return state.inventoryStates[index];
      },
    },

    shopSetting: {
      async findUnique({ where }) {
        if (state.shopSettingReadError) {
          throw state.shopSettingReadError;
        }
        return (
          state.shopSettings.find((row) => row.shop === where.shop) || null
        );
      },
      async upsert({ where, create, update }) {
        const index = state.shopSettings.findIndex(
          (row) => row.shop === where.shop,
        );
        if (index < 0) {
          const row = { updatedAt: new Date(), ...create };
          state.shopSettings.push(row);
          return row;
        }
        state.shopSettings[index] = {
          ...state.shopSettings[index],
          ...update,
          updatedAt: new Date(),
        };
        return state.shopSettings[index];
      },
    },

    processedWebhook: {
      async create({ data }) {
        if (state.processedWebhooks.some((row) => row.id === data.id)) {
          const error = new Error("Unique constraint failed");
          error.code = "P2002";
          throw error;
        }
        const row = { createdAt: new Date(), ...data };
        state.processedWebhooks.push(row);
        return row;
      },
      async deleteMany({ where }) {
        const before = state.processedWebhooks.length;
        state.processedWebhooks = state.processedWebhooks.filter(
          (row) => !(row.id === where.id && row.shop === where.shop),
        );
        return { count: before - state.processedWebhooks.length };
      },
    },

    async $transaction(operations) {
      const results = [];
      for (const operation of operations) {
        results.push(await operation);
      }
      return results;
    },

    __state: state,
  };

  return dbClient;
}

export async function recordProcessedWebhook(dbClient, { id, shop, topic }) {
  try {
    await dbClient.processedWebhook.create({ data: { id, shop, topic } });
    return { duplicate: false };
  } catch (error) {
    if (error.code === "P2002") {
      return { duplicate: true };
    }
    throw error;
  }
}
