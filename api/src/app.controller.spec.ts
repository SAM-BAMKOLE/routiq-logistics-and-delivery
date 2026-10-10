import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let controller: AppController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    controller = module.get(AppController);
  });

  describe('getInfo', () => {
    it('returns the API discovery document', () => {
      const info = controller.getInfo();

      expect(info).toEqual({
        name: 'LDMS API',
        version: '0.1.0',
        docs: '/docs',
        liveness: '/health/live',
        readiness: '/health/ready',
      });
    });
  });
});
