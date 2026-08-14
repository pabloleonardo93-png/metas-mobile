import { QueryTypes, type Sequelize } from 'sequelize';
import type { UmzugStorage } from 'umzug';

export class MigrationStorage implements UmzugStorage<Sequelize> {
  public constructor(private readonly database: Sequelize) {}

  public async executed(): Promise<string[]> {
    const rows = await this.database.query<{ name: string }>(
      'SELECT name FROM metas.schema_migrations ORDER BY name',
      { type: QueryTypes.SELECT },
    );
    return rows.map(({ name }) => name);
  }

  public async logMigration({ name }: { name: string }): Promise<void> {
    await this.database.query('INSERT INTO metas.schema_migrations (name) VALUES (:name)', {
      replacements: { name },
    });
  }

  public async unlogMigration({ name }: { name: string }): Promise<void> {
    await this.database.query('DELETE FROM metas.schema_migrations WHERE name = :name', {
      replacements: { name },
    });
  }
}
