import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ALL_BIOMES, ALL_PLOT_STATUSES } from '@empire/shared';

/** Splits `a,b,c` into an array. Query params arrive as a single string. */
const csv = ({ value }: { value: unknown }) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim().toUpperCase())
      .filter(Boolean);
  }
  return value;
};

const toInt = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? Number.parseInt(value, 10) : value;

/**
 * Viewport query.
 *
 * Bounds are required: there is no "give me everything" form of this
 * endpoint. The service clamps whatever arrives to the world and to a
 * hard plot cap, so an oversized request is narrowed rather than served.
 */
export class ViewportQueryDto {
  @ApiProperty({ description: 'Left edge of the viewport, in plot coordinates.' })
  @Transform(toInt)
  @IsInt()
  @Min(-100000)
  @Max(100000)
  minX!: number;

  @ApiProperty()
  @Transform(toInt)
  @IsInt()
  @Min(-100000)
  @Max(100000)
  minY!: number;

  @ApiProperty()
  @Transform(toInt)
  @IsInt()
  @Min(-100000)
  @Max(100000)
  maxX!: number;

  @ApiProperty()
  @Transform(toInt)
  @IsInt()
  @Min(-100000)
  @Max(100000)
  maxY!: number;

  @ApiPropertyOptional({
    description: 'Comma-separated plot statuses.',
    example: 'FREE,FOR_SALE',
  })
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsIn(ALL_PLOT_STATUSES as unknown as string[], { each: true })
  status?: string[];

  @ApiPropertyOptional({ description: 'Comma-separated biomes.', example: 'GRASSLAND,FOREST' })
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsIn(ALL_BIOMES as unknown as string[], { each: true })
  biome?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  regionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  zoneId?: string;
}

export class RegionFilterDto {
  @ApiPropertyOptional({ description: 'Comma-separated biomes.' })
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @IsIn(ALL_BIOMES as unknown as string[], { each: true })
  biome?: string[];
}

export class SearchQueryDto {
  @ApiProperty({
    description: 'Commander name, plot code (R3-4:Z18-22:P92-113) or "x,y" coordinates.',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  q!: string;
}

export class NearbyQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 4, default: 2 })
  @IsOptional()
  @Transform(toInt)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  radius?: number;
}

/**
 * Purchase request.
 *
 * The plot id is the *only* thing the client supplies. Price, owner and
 * eligibility are all resolved server-side - accepting a price here would be
 * handing the client a discount slider.
 */
export class PurchasePlotDto {
  @ApiProperty({ description: 'Id of the FREE plot to claim.' })
  @IsUUID()
  plotId!: string;
}
