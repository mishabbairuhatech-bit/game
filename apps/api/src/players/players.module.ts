import { Module } from '@nestjs/common';
import { WorldModule } from '../world/world.module';
import { PlayerBootstrapService } from './player-bootstrap.service';
import { PlayersController } from './players.controller';
import { PlayersService } from './players.service';

/**
 * WorldModule is imported for TerritoryService: starter allocation runs inside
 * the account-provisioning transaction, and every plot ownership transition -
 * including the very first one - goes through the service that owns them.
 */
@Module({
  imports: [WorldModule],
  controllers: [PlayersController],
  providers: [PlayerBootstrapService, PlayersService],
  exports: [PlayerBootstrapService, PlayersService],
})
export class PlayersModule {}
