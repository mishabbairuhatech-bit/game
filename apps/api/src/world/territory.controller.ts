import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  Authenticated,
  ClientIp,
  CurrentUser,
  RequestId,
  UserAgent,
} from '../common/decorators';
import { NearbyQueryDto, PurchasePlotDto } from './dto/world.dto';
import {
  TerritoryService,
  PurchaseResult,
  TerritoryView,
} from './territory.service';
import { PlotSummary } from './world.service';

@ApiTags('territory')
@Authenticated()
@Controller('player/territory')
export class TerritoryController {
  constructor(private readonly territory: TerritoryService) {}

  @Get()
  @ApiOperation({
    summary: "The signed-in player's holdings.",
    description:
      'Owned plots, the bounding box the camera should frame, the starter holding ' +
      '("My Empire"), and whether expansion is currently allowed.',
  })
  getMyTerritory(@CurrentUser('id') userId: string): Promise<TerritoryView> {
    return this.territory.getMyTerritory(userId);
  }

  @Get('nearby')
  @ApiOperation({
    summary: 'Free plots near the player, as expansion candidates.',
    description:
      'Scoped to a ring around the plots already held, so the result set is bounded ' +
      'by the size of the empire rather than the size of the world.',
  })
  getNearby(
    @CurrentUser('id') userId: string,
    @Query() query: NearbyQueryDto,
  ): Promise<PlotSummary[]> {
    return this.territory.getNearbyExpansion(userId, query.radius ?? 2);
  }

  /**
   * Claiming land moves money, so it gets a tighter budget than a read: a
   * script hammering this endpoint is either buggy or hostile, and either way
   * should be slowed down.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('purchase')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Claim a FREE plot from the world.',
    description:
      'The request carries only a plot id. Price, adjacency, plot limit, HQ level, ' +
      'cooldown and the coin debit are all resolved server-side inside one ' +
      'serializable transaction, and the transfer is guarded so two simultaneous ' +
      'buyers cannot both succeed.',
  })
  purchase(
    @CurrentUser('id') userId: string,
    @Body() dto: PurchasePlotDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string | null,
    @RequestId() requestId: string | null,
  ): Promise<PurchaseResult> {
    return this.territory.purchaseFreePlot(userId, dto.plotId, { ip, userAgent, requestId });
  }
}
