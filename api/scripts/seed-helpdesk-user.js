import { closeMongo, connectMongo, ensureIndexes } from "../src/database/mongodb.js";
import { seedDefaultHelpdeskUser } from "../src/services/helpdesk-auth.js";

async function main() {
  await connectMongo();
  await ensureIndexes();
  const result = await seedDefaultHelpdeskUser();
  const action = result.created ? "dibuat" : "sudah ada";
  console.log(`User helpdesk awal ${action}: ${result.user.helpdesk_id} (${result.user.name})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongo();
  });
