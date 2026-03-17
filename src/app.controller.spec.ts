import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('GET /', () => {
    it('returns API info with documentation and health links', () => {
      const result = appController.getInfo();
      expect(result.name).toBe('FX Trading App API');
      expect(result.documentation).toBe('/api/docs');
      expect(result.health).toBe('/health');
    });
  });
});
