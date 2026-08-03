# Deploy Noderyx Framework on AWS

## Easiest managed option: Elastic Beanstalk

This repository includes a `Procfile`, so Elastic Beanstalk can start it
without custom server configuration.

1. Create a ZIP containing the project files at the ZIP root. Do not include
   `.git`, `.env`, or `node_modules`.
2. In AWS Elastic Beanstalk, create a **Web server environment**.
3. Choose the current **Node.js** managed platform and upload the ZIP.
4. Under environment properties, add `NODE_ENV=production`,
   `SITE_NAME=Your Site`, and the required database variables.
5. Set the health-check path to `/health`.
6. Deploy. Elastic Beanstalk supplies `PORT`; the application reads it
   automatically.

Use Amazon RDS for MySQL or PostgreSQL. Use Amazon DocumentDB only after
checking MongoDB feature compatibility, or connect to MongoDB Atlas.

## Portable option: Docker

Build and verify locally:

```bash
docker build -t noderyx-framework .
docker run --rm -p 3000:3000 --env-file .env noderyx-framework
```

Open `http://localhost:3000/health`.

The same image can be pushed to Amazon ECR and deployed with App Runner, ECS
Fargate, or Elastic Beanstalk's Docker platform. Configure container port
`3000`, health path `/health`, and secrets through the AWS service rather than
baking them into the image.

## Production checklist

- Put the app and database in compatible network/security groups.
- Permit database traffic only from the application, not the entire internet.
- Store passwords in AWS Secrets Manager or environment secrets.
- Enable HTTPS using the platform's managed load balancer/domain settings.
- Send application logs to CloudWatch.
- Use at least two instances when the application must survive an instance
  restart.
