import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FxRate } from './entities/fx-rate.entity';
import { FxController } from './fx.controller';
import { FxService } from './fx.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FxRate]),
    HttpModule.register({ timeout: 5000, maxRedirects: 3 }),
  ],
  controllers: [FxController],
  providers: [FxService],
  exports: [FxService],
})
export class FxModule {}
