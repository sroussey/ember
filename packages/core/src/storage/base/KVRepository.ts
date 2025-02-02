//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import EventEmitter from "eventemitter3";
import { makeFingerprint } from "../../util/Misc";

/**
 * Type definitions for key-value repository events
 */
export type KVEvents = "put" | "get" | "search" | "delete" | "clearall";

/**
 * Schema definitions for primary keys and values
 */
export type BasicKeyType = string | number | bigint;
export type BasicValueType = string | number | bigint | boolean | null;
export type BasePrimaryKeySchema = Record<string, "string" | "number" | "boolean" | "bigint">;
export type BaseValueSchema = Record<string, "string" | "number" | "boolean" | "bigint">;

/**
 * Default schema types for simple string key-value pairs
 */
export type DefaultPrimaryKeyType = { "kv-key": string };
export const DefaultPrimaryKeySchema: BasePrimaryKeySchema = { "kv-key": "string" } as const;

export type DefaultValueType = { "kv-value": string };
export const DefaultValueSchema: BaseValueSchema = { "kv-value": "string" } as const;

/**
 * Abstract base class for key-value storage repositories.
 * Provides a flexible interface for storing and retrieving data with typed
 * keys and values, and supports comound keys and partial key lookup.
 * Has a basic event emitter for listening to repository events.
 *
 * @typeParam Key - Type for the primary key structure
 * @typeParam Value - Type for the value structure
 * @typeParam PrimaryKeySchema - Schema definition for the primary key
 * @typeParam ValueSchema - Schema definition for the value
 * @typeParam Combined - Combined type of Key & Value
 */
export abstract class KVRepository<
  Key extends Record<string, BasicKeyType> = DefaultPrimaryKeyType,
  Value extends Record<string, any> = DefaultValueType,
  PrimaryKeySchema extends BasePrimaryKeySchema = typeof DefaultPrimaryKeySchema,
  ValueSchema extends BaseValueSchema = typeof DefaultValueSchema,
  Combined extends Record<string, any> = Key & Value,
> {
  // KV repository event emitter
  private events = new EventEmitter<KVEvents>();
  on(
    name: EventEmitter.EventNames<KVEvents>,
    fn: EventEmitter.EventListener<KVEvents, EventEmitter.EventNames<KVEvents>>
  ) {
    this.events.on.call(this.events, name, fn);
  }
  off(
    name: EventEmitter.EventNames<KVEvents>,
    fn: EventEmitter.EventListener<KVEvents, EventEmitter.EventNames<KVEvents>>
  ) {
    this.events.off.call(this.events, name, fn);
  }
  emit(
    name: EventEmitter.EventNames<KVEvents>,
    ...args: Parameters<EventEmitter.EventListener<KVEvents, EventEmitter.EventNames<KVEvents>>>
  ) {
    this.events.emit.call(this.events, name, ...args);
  }
  /**
   * Indexes for primary key and value columns which are _only_ populated if the
   * key or value schema has a single field.
   */
  protected primaryKeyIndex: string | undefined = undefined;
  protected valueIndex: string | undefined = undefined;
  /**
   * Creates a new KVRepository instance
   * @param primaryKeySchema - Schema defining the structure of primary keys
   * @param valueSchema - Schema defining the structure of values
   * @param searchable - Array of columns to make searchable
   */
  constructor(
    protected primaryKeySchema: PrimaryKeySchema = DefaultPrimaryKeySchema as PrimaryKeySchema,
    protected valueSchema: ValueSchema = DefaultValueSchema as ValueSchema,
    protected searchable: Array<keyof Combined> = []
  ) {
    this.primaryKeySchema = primaryKeySchema;
    this.valueSchema = valueSchema;
    if (this.primaryKeyColumns().length === 1) {
      this.primaryKeyIndex = this.primaryKeyColumns()[0] as string;
    }
    if (this.valueColumns().length === 1) {
      this.valueIndex = this.valueColumns()[0] as string;
    }
    const firstKeyPart = this.primaryKeyColumns()[0] as keyof Combined;
    if (!searchable.includes(firstKeyPart)) {
      searchable.push(firstKeyPart);
    }
    this.searchable = searchable;

    // make sure all the searchable columns are in the primary key schema or value schema
    for (const column of this.searchable) {
      if (!(column in this.primaryKeySchema) && !(column in this.valueSchema)) {
        throw new Error(
          `Searchable column ${column as string} is not in the primary key schema or value schema`
        );
      }
    }
  }

  /**
   * Core abstract methods that must be implemented by concrete repositories
   */
  abstract putKeyValue(key: Key, value: Value): Promise<void>;
  abstract getKeyValue(key: Key): Promise<Value | undefined>;
  abstract deleteKeyValue(key: Key | Combined): Promise<void>;
  abstract getAll(): Promise<Combined[] | undefined>;
  abstract deleteAll(): Promise<void>;
  abstract size(): Promise<number>;

  /**
   * Stores a key-value pair in the repository.
   * Automatically converts simple types to structured format if using default schema.
   *
   * @param key - Primary key (can be simple type if using a single property key like default schema)
   * @param value - Value to store (can be simple type if using a single property value like default schema)
   */
  public put(key: BasicKeyType | Key, value: Value | BasicValueType): Promise<void> {
    if (typeof key !== "object" && this.primaryKeyIndex) {
      key = { [this.primaryKeyIndex]: key } as Key;
      if (typeof value !== "object" && this.valueIndex) {
        value = { [this.valueIndex]: value } as Value;
      }
    }
    return this.putKeyValue(key as Key, value as Value);
  }

  /**
   * Retrieves a value by its key.
   * For default schema, returns the simple value type directly.
   *
   * @param key - Primary key to look up (can be simple type if using a single property key like default schema)
   * @returns The stored value or undefined if not found
   */
  public async get(key: BasicKeyType | Key): Promise<Value | BasicValueType | undefined> {
    /* if the key is not an object, and there is a primary key index, then we need to convert the key to an object
     * this allows us to do simple "key" / "value" situations without having to use objects like a compound key
     * would require */
    const isKeySimple = !!(typeof key !== "object" && this.primaryKeyIndex);
    if (isKeySimple) {
      key = { [this.primaryKeyIndex!]: key } as Key;
    }
    const value = await this.getKeyValue(key as Key);
    if (typeof value !== "object") return value;
    if (isKeySimple && this.valueIndex) {
      /* if it looks like we are doing a simple "key" / "value" situation, then we need to return 
      the value as a simple type as well. */
      return value[this.valueIndex] as BasicValueType;
    }
    return value as Value;
  }

  /**
   * Abstract method to be implemented by concrete repositories to search for key-value pairs
   * based on a partial key or value.
   *
   * @param key - Partial key or value to search for
   * @returns Promise resolving to an array of combined key-value objects or undefined if not found
   */
  public abstract search(key: Partial<Combined>): Promise<Combined[] | undefined>;

  /**
   * Retrieves both key and value as a combined object.
   *
   * @param key - Primary key to look up (can be simple type if using a single property key like default schema)
   * @returns Combined key-value object or undefined if not found
   */
  public async getCombined(key: Key): Promise<Combined | undefined> {
    const value = await this.getKeyValue(key);
    if (typeof value !== "object") return undefined;
    return Object.assign({}, key, value) as Combined;
  }

  /**
   * Deletes a key-value pair from the repository.
   * Automatically converts simple types to structured format if using default schema.
   *
   * @param key - Primary key to delete (can be simple type if using a single property key like default schema)
   */
  public delete(key: Key | BasicKeyType): Promise<void> {
    if (typeof key !== "object" && this.primaryKeyIndex) {
      key = { [this.primaryKeyIndex]: key } as Key;
    }
    return this.deleteKeyValue(key as Key);
  }

  protected primaryKeyColumns(): Array<keyof Key> {
    return Object.keys(this.primaryKeySchema);
  }

  protected valueColumns(): Array<keyof Value> {
    return Object.keys(this.valueSchema);
  }

  /**
   * Utility method to separate a combined object into its key and value components
   * based on the defined schemas.
   *
   * @param obj - Combined key-value object
   * @returns Separated key and value objects
   */
  protected separateKeyValueFromCombined(obj: Combined): { value: Value; key: Key } {
    if (obj === null) {
      console.warn("Key is null");
      return { value: {} as Value, key: {} as Key };
    }
    if (typeof obj !== "object") {
      console.warn("Object is not an object");
      return { value: {} as Value, key: {} as Key };
    }
    const primaryKeyNames = this.primaryKeyColumns();
    const valueNames = this.valueColumns();
    const value: Partial<Value> = {};
    const key: Partial<Key> = {};
    for (const k of primaryKeyNames) {
      key[k] = obj[k as keyof Combined];
    }
    for (const k of valueNames) {
      value[k] = obj[k as keyof Combined];
    }

    return { value: value as Value, key: key as Key };
  }

  /**
   * Generates a consistent string identifier for a given key.
   *
   * @param key - Primary key to convert
   * @returns Promise resolving to a string fingerprint of the key
   */
  protected async getKeyAsIdString(key: Key | BasicKeyType): Promise<string> {
    if (this.primaryKeyIndex && typeof key === "object") {
      key = key[this.primaryKeyIndex];
    }
    return await makeFingerprint(key);
  }
}
