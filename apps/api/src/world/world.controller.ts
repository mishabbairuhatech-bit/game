import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Biome, PlotStatus } from '@prisma/client';
import { Authenticated, CurrentUser, OptionalAuth, Public } from '../common/decorators';
import {
  WorldService,
  PlotDetail,
  RegionView,
  ViewportResult,
  WorldView,
  ZoneView,
} from './world.service';
import { RegionFilterDto, SearchQueryDto, ViewportQueryDto } from './dto/world.dto';

/**
 * Read-only map endpoints.
 *
 * The world's shape is public - it is the same for every player and the
 * client needs it before signing in to render the landing map. Ownership
 * details are not: `isMine` and the action list are computed against the
 * caller, and an anonymous caller simply gets `isMine: false` everywhere.
 */
@ApiTags('world')
@Controller('world')
export class WorldController {
  constructor(private readonly world: WorldService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'The active world: geometry, seed and occupancy.',
    description:
      'The seed is returned deliberately - terrain is deterministic and public, ' +
      'so the client regenerates sub-plot detail locally instead of downloading it.',
  })
  describe(): Promise<WorldView> {
    return this.world.describeWorld();
  }

  @Public()
  @Get('regions')
  @ApiOperation({
    summary: 'Every region in the world.',
    description:
      'Bounded by construction - the development world has 100 regions. This is ' +
      'the far-zoom summary layer; it never returns plots.',
  })
  listRegions(@Query() query: RegionFilterDto): Promise<RegionView[]> {
    return this.world.listRegions(query.biome as Biome[] | undefined);
  }

  @Public()
  @Get('regions/:regionId')
  @ApiParam({ name: 'regionId', format: 'uuid' })
  @ApiOperation({ summary: 'One region, with its plot occupancy counters.' })
  getRegion(@Param('regionId', ParseUUIDPipe) regionId: string) {
    return this.world.getRegion(regionId);
  }

  @Public()
  @Get('regions/:regionId/zones')
  @ApiParam({ name: 'regionId', format: 'uuid' })
  @ApiOperation({ summary: 'The zones inside a region.' })
  listZones(@Param('regionId', ParseUUIDPipe) regionId: string): Promise<ZoneView[]> {
    return this.world.listZonesInRegion(regionId);
  }

  @Public()
  @Get('zones/:zoneId')
  @ApiParam({ name: 'zoneId', format: 'uuid' })
  @ApiOperation({
    summary: 'One zone and all of its plots.',
    description: 'A zone holds at most (zoneSize/plotSize)^2 plots, so this is inherently bounded.',
  })
  getZone(@Param('zoneId', ParseUUIDPipe) zoneId: string) {
    return this.world.getZone(zoneId);
  }

  @OptionalAuth()
  @Get('plots')
  @ApiOperation({
    summary: 'Plots inside a viewport.',
    description:
      'Bounds are mandatory and are clamped to the world and to a hard cap before ' +
      'the query runs, so no request can ask for the whole world. A truncated ' +
      'response sets `truncated: true` so the client can fall back to region ' +
      'summaries rather than silently showing partial data.',
  })
  queryViewport(
    @Query() query: ViewportQueryDto,
    @CurrentUser('id') viewerId: string | undefined,
  ): Promise<ViewportResult> {
    return this.world.queryViewport(
      {
        minX: query.minX,
        minY: query.minY,
        maxX: query.maxX,
        maxY: query.maxY,
        status: query.status as PlotStatus[] | undefined,
        biome: query.biome as Biome[] | undefined,
        regionId: query.regionId,
        zoneId: query.zoneId,
      },
      viewerId ?? null,
    );
  }

  @OptionalAuth()
  @Get('search')
  @ApiOperation({
    summary: 'Find a plot by code, by "x,y" coordinates, or by commander name.',
  })
  search(@Query() query: SearchQueryDto, @CurrentUser('id') viewerId: string | undefined) {
    return this.world.search(query.q, viewerId ?? null);
  }
}

/**
 * Plot detail lives on its own path so a permalink to a plot does not have to
 * know which world it belongs to.
 */
@ApiTags('world')
@Controller('plots')
export class PlotsController {
  constructor(private readonly world: WorldService) {}

  @OptionalAuth()
  @Get(':idOrCode')
  @ApiParam({
    name: 'idOrCode',
    description: 'Plot UUID or plot code, e.g. R3-4:Z18-22:P92-113.',
  })
  @ApiOperation({
    summary: 'Full detail for one plot, including what the caller may do with it.',
    description:
      'Owner information is limited to the public display name. The `actions` block ' +
      'is computed server-side so the UI cannot offer something the API would refuse.',
  })
  getPlot(
    @Param('idOrCode') idOrCode: string,
    @CurrentUser('id') viewerId: string | undefined,
  ): Promise<PlotDetail> {
    return this.world.getPlotDetail(idOrCode, viewerId ?? null);
  }
}

/** Authenticated territory endpoints - always scoped to the caller. */
@ApiTags('world')
@Authenticated()
@Controller('player/territory')
export class TerritoryReadController {
  constructor(private readonly world: WorldService) {}

  @Get('world')
  @ApiOperation({ summary: 'World metadata, for clients that already hold a session.' })
  describe(): Promise<WorldView> {
    return this.world.describeWorld();
  }
}
