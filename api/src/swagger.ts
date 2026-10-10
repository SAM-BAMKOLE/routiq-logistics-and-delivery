import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SWAGGER_PATH } from './constants.js';

export function configureSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('LDMS API')
    .setDescription(
      'Logistics & Delivery Management System - multi-tenant delivery API. ' +
        'Tenants manage fleets, shipments, dispatch and route planning through ' +
        'this versioned REST interface.',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    // Deep-tagged operation groups come from the controllers themselves.
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
  });
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}
