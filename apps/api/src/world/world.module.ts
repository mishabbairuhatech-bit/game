import { Module } from '@nestjs/common';
import { WorldController, PlotsController, TerritoryReadController } from './world.controller';
import { TerritoryController } from './territory.controller';
import { WorldService } from './world.service';
import { TerritoryService } from './territory.service';
import { WorldGeneratorService } from './world-generator.service';

/**
 * The persistent world: generation, map queries and territory ownership.
 *
 * TerritoryService is exported because PlayerBootstrapService calls
 * `assignStarterTerritory` inside the account-provisioning transaction.
 */
@Module({
  controllers: [
    WorldController,
    PlotsController,
    TerritoryReadController,
    TerritoryController,
  ],
  providers: [WorldService, TerritoryService, WorldGeneratorService],
  exports: [WorldService, TerritoryService, WorldGeneratorService],
})
export class WorldModule {}
