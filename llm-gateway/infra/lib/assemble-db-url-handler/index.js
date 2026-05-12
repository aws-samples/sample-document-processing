const { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const client = new SecretsManagerClient();

exports.handler = async (event) => {
  if (event.RequestType === 'Delete') {
    return { PhysicalResourceId: event.PhysicalResourceId || 'assemble-secrets' };
  }

  const { DbSecretArn, UrlSecretArn, MasterKeySecretArn, DatabaseName } = event.ResourceProperties;

  // Assemble DATABASE_URL from RDS secret
  const dbSecretResponse = await client.send(
    new GetSecretValueCommand({ SecretId: DbSecretArn })
  );
  const dbCreds = JSON.parse(dbSecretResponse.SecretString);
  const databaseUrl = `postgresql://${encodeURIComponent(dbCreds.username)}:${encodeURIComponent(dbCreds.password)}@${dbCreds.host}:${dbCreds.port}/${DatabaseName}`;

  await client.send(
    new PutSecretValueCommand({
      SecretId: UrlSecretArn,
      SecretString: databaseUrl,
    })
  );

  // Assemble admin key with sk- prefix
  const adminKeyResponse = await client.send(
    new GetSecretValueCommand({ SecretId: MasterKeySecretArn })
  );
  const adminKeyJson = JSON.parse(adminKeyResponse.SecretString);
  const adminKey = `sk-${adminKeyJson.suffix}`;

  await client.send(
    new PutSecretValueCommand({
      SecretId: MasterKeySecretArn,
      SecretString: adminKey,
    })
  );

  return { PhysicalResourceId: 'assemble-secrets' };
};
