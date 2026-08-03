import { Model } from "../../framework/index.js";

export class User extends Model {
  static table = "users";
  static primaryKey = "id";
  static fillable = ["name", "email", "password"];
}
