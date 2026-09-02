import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';

interface IndexPresence {
  present: boolean;
}

export const hasFirstEnrollmentRequestUniqueIndex = async (
  database: Sequelize,
  transaction?: Transaction,
): Promise<boolean> => {
  const rows = await database.query<IndexPresence>(
    `SELECT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_index index_metadata
       JOIN pg_catalog.pg_class table_relation
         ON table_relation.oid = index_metadata.indrelid
       JOIN pg_catalog.pg_namespace table_namespace
         ON table_namespace.oid = table_relation.relnamespace
       JOIN pg_catalog.pg_attribute indexed_attribute
         ON indexed_attribute.attrelid = table_relation.oid
        AND indexed_attribute.attnum = index_metadata.indkey[0]
       WHERE table_namespace.nspname = 'metas'
         AND table_relation.relname = 'platform_admin_webauthn_challenges'
         AND index_metadata.indisunique = TRUE
         AND index_metadata.indisprimary = FALSE
         AND index_metadata.indisvalid = TRUE
         AND index_metadata.indisready = TRUE
         AND index_metadata.indexprs IS NULL
         AND index_metadata.indpred IS NOT NULL
         AND index_metadata.indnkeyatts = 1
         AND index_metadata.indnatts = 1
         AND indexed_attribute.attname = 'first_enrollment_request_id'
         AND pg_catalog.regexp_replace(
           pg_catalog.lower(
             pg_catalog.pg_get_expr(index_metadata.indpred, index_metadata.indrelid)
           ),
           '[[:space:]()]',
           '',
           'g'
         ) = 'first_enrollment_request_idisnotnull'
     ) AS present`,
    { transaction: transaction ?? null, type: QueryTypes.SELECT },
  );

  return rows[0]?.present === true;
};
